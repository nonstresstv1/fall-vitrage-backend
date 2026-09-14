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

  const paidResult = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE order_id = $1', [orderId]
  );
  order.total_paid = Number(paidResult.rows[0].total_paid);
  order.remaining = Number(order.total_price) - order.total_paid;
  order.discount = Number(order.discount || 0);
  order.subtotal = Number(order.total_price) + order.discount;

  const settingsResult = await pool.query('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  const settings = settingsResult.rows[0] || { company_name: 'Darou Salam Miroir', phone: '', address: '' };

  return { order, items: itemsResult.rows, settings };
}

const STATUS_LABELS = {
  paye: 'Payé',
  partiel: 'Partiellement payé',
  non_paye: 'Non payé'
};

async function createAndDownload(req, res) {
  const { orderId } = req.params;

  try {
    const data = await getOrderFull(orderId);
    if (!data) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }
    const { order, items, settings } = data;

    // Enregistrer la facture en base
    const invoiceNumber = generateInvoiceNumber();
    await pool.query(
      'INSERT INTO invoices (invoice_number, order_id, created_by) VALUES ($1, $2, $3)',
      [invoiceNumber, orderId, req.user.id]
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="facture-${invoiceNumber}.pdf"`);
    doc.pipe(res);

    const NAVY = '#0f4c81';
    const LIGHT = '#f2f6fa';
    const MUTED = '#5c6f7a';
    const LINE = '#d8e0e6';
    const LEFT = 50;
    const RIGHT = 545;

    // ---------- En-tête ----------
    doc.fontSize(22).fillColor(NAVY).font('Helvetica-Bold').text(settings.company_name || 'Darou Salam Miroir', LEFT, 60);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    if (settings.address) doc.text(settings.address, 50, 88);
    if (settings.phone) doc.text(`Tél : ${settings.phone}`, 50, 104);
    doc.text(`Facture : ${invoiceNumber}`, 50, 140);
    doc.text(`Commande : ${order.order_number}`, 50, 156);
    doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 50, 172);

    // ---------- Bloc client ----------
    doc.rect(LEFT, 196, RIGHT - LEFT, 78).fill('#f7f9fb');
    doc.rect(LEFT, 196, 3, 78).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('FACTURÉ À', 68, 208);
    doc.font('Helvetica').fillColor('#172733');
    doc.text(order.customer_name, 68, 224);
    doc.text(`Téléphone : ${order.phone}`, 68, 240);
    if (order.address) doc.text(`Adresse : ${order.address}`, 68, 256);

    // ---------- Titre ----------
    doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('Détails de la commande', LEFT, 300);
    doc.moveDown(0.5);

    // ---------- Table ----------
    const colX = { produit: LEFT, dims: 195, prix: 330, total: 460 };
    const colW = { produit: 140, dims: 130, prix: 125, total: 85 };
    const headerH = 20;
    const rowH = 18;
    const pageBottom = 700;

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

    let y = drawHeaderRow(doc.y);
    items.forEach((item, index) => {
      y = drawDataRow(y, item, index);
    });
    y += 6;

    // ---------- Totaux ----------
    if (y > pageBottom - 110) {
      doc.addPage();
      y = 60;
    }

    const totalsX = 350;
    const totalsW = RIGHT - totalsX;

    function totLabel(text) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(text, totalsX, y, { width: totalsW - 110 });
    }
    function totValue(text, opts) {
      doc.font(opts && opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
        .fillColor(opts && opts.color ? opts.color : '#172733')
        .text(text, totalsX + totalsW - 95, y, { width: 95, align: 'right' });
    }

    doc.text(`Nombre de lignes : ${items.length}`, LEFT, y, { width: 260 });
    y += 20;

    totLabel('Sous-total');
    totValue(money(order.subtotal));
    y += 16;

    if (order.discount > 0) {
      totLabel('Remise');
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
      LEFT, y
    );

    // ---------- Pied de page ----------
    doc.moveTo(LEFT, 720).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Merci de votre confiance — Darou Salam Miroir', LEFT, 730, { align: 'center', width: RIGHT - LEFT });

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