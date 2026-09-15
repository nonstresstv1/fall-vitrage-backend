const PDFDocument = require('pdfkit');
const pool = require('../config/db');

function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FAC-${y}${m}-${rand}`;
}

// Formatte un montant en francs: séparateur des milliers = espace normale
// (U+0020), car Helvetica (PDFKit) n'affiche pas l'espace insécable étroite
// U+202F renvoyée par toLocaleString('fr-FR') -> d'où les "7 /938 F" lus avant.
function money(n) {
  return Number(n).toLocaleString('fr-FR')
    .replace(/[\u202F\u00A0]/g, ' ') + ' F';
}

// Retire les zéros inutiles : 30.000 -> "30", 1.200 -> "1.2", 0.800 -> "0.8"
function dim(n) {
  return String(Math.round(Number(n) * 1000) / 1000);
}

// Formate une quantité décimale : 4.5 -> "4,5", 2 -> "2"
function qty(n) {
  return String(Math.round(Number(n) * 100) / 100).replace('.', ',');
}

async function getOrderFull(orderId) {
  const orderResult = await pool.query(`
    SELECT o.*, c.full_name AS customer_name, c.phone, c.address
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = $1
  `, [orderId]);
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(`
    SELECT oi.*, g.name AS glass_name
    FROM order_items oi
    JOIN glass_types g ON g.id = oi.glass_type_id
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
  `, [orderId]);

  const hardwareResult = await pool.query(`
    SELECT ohi.*, hp.name AS hardware_name, hp.reference AS hardware_reference
    FROM order_hardware_items ohi
    JOIN hardware_products hp ON hp.id = ohi.hardware_product_id
    WHERE ohi.order_id = $1
    ORDER BY ohi.id ASC
  `, [orderId]);

  const paidResult = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE order_id = $1', [orderId]
  );
  order.total_paid = Number(paidResult.rows[0].total_paid);
  order.remaining = Number(order.total_price) - order.total_paid;
  order.discount = Number(order.discount || 0);
  order.subtotal = Number(order.total_price) + order.discount;

  const glassSubtotal = itemsResult.rows.reduce((s, it) => s + Number(it.line_total), 0);
  const hardwareSubtotal = hardwareResult.rows.reduce((s, it) => s + Number(it.line_total), 0);

  const settingsResult = await pool.query('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  const settings = settingsResult.rows[0] || { company_name: 'Darou Salam Miroir', phone: '', address: '' };

  return {
    order,
    items: itemsResult.rows,
    hardware_items: hardwareResult.rows,
    glassSubtotal,
    hardwareSubtotal,
    settings
  };
}

const STATUS_LABELS = {
  paye: 'Payé',
  partiel: 'Partiellement payé',
  non_paye: 'Non payé'
};

const UNIT_LABELS = {
  piece: 'Pièce',
  boite: 'Boîte',
  sac: 'Sac',
  metre: 'Mètre',
  kilogramme: 'Kilogramme',
  litre: 'Litre',
  autre: 'Autre'
};

function unitLabel(unit) {
  return UNIT_LABELS[unit] || unit || 'Pièce';
}

// ------------------------------------------------------------------
// Dessine l'en-tête de facture (entreprise, n° facture, commande, date)
// ------------------------------------------------------------------
function drawHeader(doc, settings, invoiceNumber, order) {
  const NAVY = '#0f4c81';
  const MUTED = '#5c6f7a';
  const LEFT = 50;

  doc.fontSize(22).fillColor(NAVY).font('Helvetica-Bold').text(settings.company_name || 'Darou Salam Miroir', LEFT, 60);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  if (settings.address) doc.text(settings.address, 50, 88);
  if (settings.phone) doc.text(`Tél : ${settings.phone}`, 50, 104);
  doc.text(`Facture : ${invoiceNumber}`, 50, 140);
  doc.text(`Commande : ${order.order_number}`, 50, 156);
  doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 50, 172);
}

// ------------------------------------------------------------------
// Dessine le bloc client
// ------------------------------------------------------------------
function drawClientBlock(doc, order) {
  const NAVY = '#0f4c81';
  const LEFT = 50;

  doc.rect(LEFT, 196, 495, 78).fill('#f7f9fb');
  doc.rect(LEFT, 196, 3, 78).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('FACTURÉ À', 68, 208);
  doc.font('Helvetica').fillColor('#172733');
  doc.text(order.customer_name, 68, 224);
  doc.text(`Téléphone : ${order.phone}`, 68, 240);
  if (order.address) doc.text(`Adresse : ${order.address}`, 68, 256);
}

// ------------------------------------------------------------------
// Totaux (sous-total, remise, total, payé, reste)
// ------------------------------------------------------------------
function drawTotals(doc, data, opts) {
  const NAVY = '#0f4c81';
  const MUTED = '#5c6f7a';
  const LIGHT = '#f2f6fa';
  const LINE = '#d8e0e6';
  const RIGHT = 545;
  const pageBottom = 700;

  let y = opts.y;
  const { order } = data;

  if (y > pageBottom - 130) {
    doc.addPage();
    y = 60;
  }

  const totalsX = 330;
  const totalsW = RIGHT - totalsX;

  function totLabel(text) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(text, totalsX, y, { width: totalsW - 95 });
  }
  function totValue(text, o2) {
    doc.font(o2 && o2.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
      .fillColor(o2 && o2.color ? o2.color : '#172733')
      .text(text, totalsX + totalsW - 95, y, { width: 95, align: 'right' });
  }

  // Sous-totaux par catégorie pour la facture complète
  let leadingLabel = null;
  if (opts.hardwareCount && opts.glassCount) {
    leadingLabel = 'Lignes';
  } else if (opts.glassCount) {
    leadingLabel = 'Nombre de découpes';
  } else if (opts.hardwareCount) {
    leadingLabel = 'Nombre de produits';
  }

  if (leadingLabel) {
    doc.text(`${leadingLabel} : ${opts.glassCount + opts.hardwareCount}`, 50, y, { width: 260 });
    y += 20;
  }

  if (opts.showGlassSubtotal) {
    totLabel('Prix des verres');
    totValue(money(data.glassSubtotal));
    y += 16;
  }
  if (opts.showHardwareSubtotal) {
    totLabel('Prix de la quincaillerie');
    totValue(money(data.hardwareSubtotal));
    y += 16;
  }

  if (opts.showSubtotal) {
    totLabel('Sous-total');
    totValue(money(opts.subtotal));
    y += 16;
  }

  if (order.discount > 0) {
    const remiseLabels = {
      verre: 'Remise sur les verres',
      quincaillerie: 'Remise sur la quincaillerie',
      all: 'Remise'
    };
    totLabel(remiseLabels[order.discount_type] || 'Remise');
    totValue(`− ${money(order.discount)}`, { color: '#2f9e5b' });
    y += 16;
  }

  y += 3;
  doc.rect(totalsX, y, totalsW, 1).fill(LINE);
  doc.rect(totalsX, y - 3, totalsW, 22).fill(LIGHT);
  totLabel('Total à payer');
  totValue(money(order.total_price), { bold: true, color: NAVY });

  y += 22;

  totLabel('Montant payé');
  totValue(money(order.total_paid));
  y += 16;

  totLabel('Reste à payer');
  totValue(money(order.remaining), { bold: true, color: order.remaining > 0 ? '#c1443b' : '#2f9e5b' });
  y += 24;

  doc.fontSize(11).fillColor(NAVY).text(
    `Statut du paiement : ${STATUS_LABELS[order.payment_status] || order.payment_status}`,
    50, y
  );

  return y;
}

function drawFooter(doc) {
  const MUTED = '#5c6f7a';
  const LINE = '#d8e0e6';
  const LEFT = 50;
  const RIGHT = 545;

  doc.moveTo(LEFT, 720).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('Merci de votre confiance — Darou Salam Miroir', LEFT, 730, { align: 'center', width: RIGHT - LEFT });
}

// ------------------------------------------------------------------
// Facture verre uniquement (mise en page existante, conservée)
// ------------------------------------------------------------------
function renderGlassInvoice(doc, data, invoiceNumber) {
  const NAVY = '#0f4c81';
  const LIGHT = '#f2f6fa';
  const LINE = '#d8e0e6';
  const LEFT = 50;
  const RIGHT = 545;
  const pageBottom = 700;
  const items = data.items;

  drawHeader(doc, data.settings, invoiceNumber, data.order);
  drawClientBlock(doc, data.order);

  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('Facture — Verre', LEFT, 300);
  doc.moveDown(0.5);

  const colX = { produit: LEFT, dims: 195, prix: 330, total: 460 };
  const colW = { produit: 140, dims: 130, prix: 125, total: 85 };
  const headerH = 20;
  const rowH = 18;

  function drawHeaderRow(y) {
    doc.rect(LEFT, y, RIGHT - LEFT, headerH).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff');
    doc.text('Produit', colX.produit + 6, y + 6, { width: colW.produit - 6 });
    doc.text('Qté × Dimensions', colX.dims + 6, y + 6, { width: colW.dims - 6 });
    doc.text('Prix unit.', colX.prix + 6, y + 6, { width: colW.prix - 12, align: 'right' });
    doc.text('Total', colX.total + 6, y + 6, { width: colW.total - 12, align: 'right' });
    doc.moveTo(LEFT, y + headerH).lineTo(RIGHT, y + headerH).lineWidth(1.5).strokeColor(NAVY).stroke();
    return y + headerH;
  }

  function drawDataRow(y, item, index) {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = drawHeaderRow(50);
    }
    if (index % 2 === 1) {
      doc.rect(LEFT, y, RIGHT - LEFT, rowH).fill(LIGHT);
    }
    doc.font('Helvetica').fontSize(9.5).fillColor('#172733');
    doc.text(item.glass_name, colX.produit + 6, y + 5, { width: colW.produit - 6 });
    doc.text(
      `${dim(item.quantity || 1)} × ${dim(item.length_m)} m × ${dim(item.width_m)} m`,
      colX.dims + 6, y + 5, { width: colW.dims - 6 }
    );
    doc.text(money(item.unit_price), colX.prix + 6, y + 5, { width: colW.prix - 12, align: 'right' });
    doc.text(money(item.line_total), colX.total + 6, y + 5, { width: colW.total - 12, align: 'right' });
    doc.moveTo(LEFT, y + rowH).lineTo(RIGHT, y + rowH).lineWidth(0.6).strokeColor(LINE).stroke();
    return y + rowH;
  }

  if (items.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#172733').text('Aucun verre dans cette commande.', LEFT, 330);
    doc.y = 360;
  } else {
    let y = drawHeaderRow(doc.y);
    items.forEach((item, index) => {
      y = drawDataRow(y, item, index);
    });
  }

  drawTotals(doc, data, {
    y: doc.y + 12,
    glassCount: items.length,
    showSubtotal: true,
    subtotal: data.glassSubtotal
  });
  drawFooter(doc);
}

// ------------------------------------------------------------------
// Facture quincaillerie uniquement
// ------------------------------------------------------------------
function renderHardwareInvoice(doc, data, invoiceNumber) {
  const NAVY = '#0f4c81';
  const LIGHT = '#f2f6fa';
  const LINE = '#d8e0e6';
  const LEFT = 50;
  const RIGHT = 545;
  const pageBottom = 700;
  const items = data.hardware_items;

  drawHeader(doc, data.settings, invoiceNumber, data.order);
  drawClientBlock(doc, data.order);

  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('Facture — Quincaillerie', LEFT, 300);
  doc.moveDown(0.5);

  const colX = { produit: LEFT, ref: 195, unite: 265, qte: 310, prix: 390, total: 470 };
  const colW = { produit: 135, ref: 70, unite: 45, qte: 78, prix: 80, total: 75 };
  const headerH = 20;
  const rowH = 18;

  function drawHeaderRow(y) {
    doc.rect(LEFT, y, RIGHT - LEFT, headerH).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    doc.text('Produit', colX.produit + 5, y + 6, { width: colW.produit - 5 });
    doc.text('Référence', colX.ref + 4, y + 6, { width: colW.ref - 4 });
    doc.text('Unité', colX.unite + 3, y + 6, { width: colW.unite - 3 });
    doc.text('Qté', colX.qte + 4, y + 6, { width: colW.qte - 8, align: 'right' });
    doc.text('Prix unit.', colX.prix + 4, y + 6, { width: colW.prix - 8, align: 'right' });
    doc.text('Total', colX.total + 4, y + 6, { width: colW.total - 8, align: 'right' });
    doc.moveTo(LEFT, y + headerH).lineTo(RIGHT, y + headerH).lineWidth(1.5).strokeColor(NAVY).stroke();
    return y + headerH;
  }

  function drawDataRow(y, item, index) {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = drawHeaderRow(50);
    }
    if (index % 2 === 1) {
      doc.rect(LEFT, y, RIGHT - LEFT, rowH).fill(LIGHT);
    }
    doc.font('Helvetica').fontSize(9).fillColor('#172733');
    doc.text(item.hardware_name, colX.produit + 5, y + 5, { width: colW.produit - 5 });
    doc.text(item.hardware_reference || '-', colX.ref + 4, y + 5, { width: colW.ref - 4 });
    doc.text(unitLabel(item.unit), colX.unite + 3, y + 5, { width: colW.unite - 3 });
    doc.text(qty(item.quantity), colX.qte + 4, y + 5, { width: colW.qte - 8, align: 'right' });
    doc.text(money(item.unit_price), colX.prix + 4, y + 5, { width: colW.prix - 8, align: 'right' });
    doc.text(money(item.line_total), colX.total + 4, y + 5, { width: colW.total - 8, align: 'right' });
    doc.moveTo(LEFT, y + rowH).lineTo(RIGHT, y + rowH).lineWidth(0.6).strokeColor(LINE).stroke();
    return y + rowH;
  }

  if (items.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#172733').text('Aucun produit de quincaillerie dans cette commande.', LEFT, 330);
    doc.y = 360;
  } else {
    let y = drawHeaderRow(doc.y);
    items.forEach((item, index) => {
      y = drawDataRow(y, item, index);
    });
  }

  drawTotals(doc, data, {
    y: doc.y + 12,
    hardwareCount: items.length,
    showSubtotal: true,
    subtotal: data.hardwareSubtotal
  });
  drawFooter(doc);
}

// ------------------------------------------------------------------
// Facture complète : verres + quincaillerie
// ------------------------------------------------------------------
function renderCompleteInvoice(doc, data, invoiceNumber) {
  const NAVY = '#0f4c81';
  const LIGHT = '#f2f6fa';
  const LINE = '#d8e0e6';
  const LEFT = 50;
  const RIGHT = 545;
  const pageBottom = 700;

  drawHeader(doc, data.settings, invoiceNumber, data.order);
  drawClientBlock(doc, data.order);

  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('Facture complète', LEFT, 300);
  doc.moveDown(0.5);

  const colX = { categorie: LEFT, designation: 130, details: 245, qte: 330, prix: 405, total: 475 };
  const colW = { categorie: 75, designation: 112, details: 80, qte: 72, prix: 68, total: 68 };
  const headerH = 20;
  const rowH = 18;

  function drawHeaderRow(y) {
    doc.rect(LEFT, y, RIGHT - LEFT, headerH).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('Catégorie', colX.categorie + 5, y + 6, { width: colW.categorie - 5 });
    doc.text('Désignation', colX.designation + 4, y + 6, { width: colW.designation - 4 });
    doc.text('Détails', colX.details + 4, y + 6, { width: colW.details - 4 });
    doc.text('Qté', colX.qte + 4, y + 6, { width: colW.qte - 8, align: 'right' });
    doc.text('Prix unit.', colX.prix + 4, y + 6, { width: colW.prix - 8, align: 'right' });
    doc.text('Total', colX.total + 4, y + 6, { width: colW.total - 8, align: 'right' });
    doc.moveTo(LEFT, y + headerH).lineTo(RIGHT, y + headerH).lineWidth(1.5).strokeColor(NAVY).stroke();
    return y + headerH;
  }

  function drawGlassRow(y, item, index) {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = drawHeaderRow(50);
    }
    if (index % 2 === 1) {
      doc.rect(LEFT, y, RIGHT - LEFT, rowH).fill(LIGHT);
    }
    doc.font('Helvetica').fontSize(8.5).fillColor('#172733');
    doc.text('VERRE', colX.categorie + 5, y + 5, { width: colW.categorie - 5 });
    doc.text(item.glass_name, colX.designation + 4, y + 5, { width: colW.designation - 4 });
    doc.text(`${dim(item.length_m)} × ${dim(item.width_m)} m`, colX.details + 4, y + 5, { width: colW.details - 4 });
    doc.text(qty(item.quantity), colX.qte + 4, y + 5, { width: colW.qte - 8, align: 'right' });
    doc.text(money(item.unit_price), colX.prix + 4, y + 5, { width: colW.prix - 8, align: 'right' });
    doc.text(money(item.line_total), colX.total + 4, y + 5, { width: colW.total - 8, align: 'right' });
    doc.moveTo(LEFT, y + rowH).lineTo(RIGHT, y + rowH).lineWidth(0.6).strokeColor(LINE).stroke();
    return y + rowH;
  }

  function drawHardwareRow(y, item, index) {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = drawHeaderRow(50);
    }
    if (index % 2 === 1) {
      doc.rect(LEFT, y, RIGHT - LEFT, rowH).fill(LIGHT);
    }
    doc.font('Helvetica').fontSize(8.5).fillColor('#172733');
    doc.text('QUINCAILLERIE', colX.categorie + 5, y + 5, { width: colW.categorie - 5 });
    doc.text(item.hardware_name, colX.designation + 4, y + 5, { width: colW.designation - 4 });
    doc.text(`${qty(item.quantity)} ${unitLabel(item.unit)}`, colX.details + 4, y + 5, { width: colW.details - 4 });
    doc.text(qty(item.quantity), colX.qte + 4, y + 5, { width: colW.qte - 8, align: 'right' });
    doc.text(money(item.unit_price), colX.prix + 4, y + 5, { width: colW.prix - 8, align: 'right' });
    doc.text(money(item.line_total), colX.total + 4, y + 5, { width: colW.total - 8, align: 'right' });
    doc.moveTo(LEFT, y + rowH).lineTo(RIGHT, y + rowH).lineWidth(0.6).strokeColor(LINE).stroke();
    return y + rowH;
  }

  const totalLines = data.items.length + data.hardware_items.length;
  if (totalLines === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#172733').text('Aucun article dans cette commande.', LEFT, 330);
    doc.y = 360;
  } else {
    let y = drawHeaderRow(doc.y);
    data.items.forEach((item, index) => {
      y = drawGlassRow(y, item, index);
    });
    data.hardware_items.forEach((item, index) => {
      y = drawHardwareRow(y, item, data.items.length + index);
    });
  }

  drawTotals(doc, data, {
    y: doc.y + 12,
    glassCount: data.items.length,
    hardwareCount: data.hardware_items.length,
    showGlassSubtotal: data.items.length > 0,
    showHardwareSubtotal: data.hardware_items.length > 0,
    showSubtotal: true,
    subtotal: data.order.subtotal
  });
  drawFooter(doc);
}

async function createAndDownload(req, res) {
  const { orderId } = req.params;
  const type = ['verre', 'quincaillerie', 'complete'].includes(req.query.type) ? req.query.type : 'complete';

  try {
    const data = await getOrderFull(orderId);
    if (!data) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    let invoiceNumber = null;
    // Seule la facture complète est enregistrée dans l'historique.
    if (type === 'complete') {
      invoiceNumber = generateInvoiceNumber();
      await pool.query(
        'INSERT INTO invoices (invoice_number, order_id, created_by) VALUES ($1, $2, $3)',
        [invoiceNumber, orderId, req.user.id]
      );
    } else {
      invoiceNumber = generateInvoiceNumber();
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    const prefix = type === 'verre' ? 'facture-verre' : type === 'quincaillerie' ? 'facture-quincaillerie' : 'facture';
    res.setHeader('Content-Disposition', `attachment; filename="${prefix}-${invoiceNumber}.pdf"`);
    doc.pipe(res);

    if (type === 'verre') {
      renderGlassInvoice(doc, data, invoiceNumber);
    } else if (type === 'quincaillerie') {
      renderHardwareInvoice(doc, data, invoiceNumber);
    } else {
      renderCompleteInvoice(doc, data, invoiceNumber);
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération de la facture.' });
    }
  }
}

async function listByOrder(req, res) {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM invoices WHERE order_id = $1 ORDER BY created_at DESC', [orderId]
    );
    res.json({ invoices: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des factures.' });
  }
}

async function listAll(req, res) {
  try {
    const result = await pool.query(`
      SELECT i.*, o.order_number, o.total_price, c.full_name AS customer_name
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      ORDER BY i.created_at DESC
    `);
    res.json({ invoices: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des factures.' });
  }
}

module.exports = { createAndDownload, listByOrder, listAll };