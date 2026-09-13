const PDFDocument = require('pdfkit');
const pool = require('../config/db');

function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FAC-${y}${m}-${rand}`;
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

  const settingsResult = await pool.query('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  const settings = settingsResult.rows[0] || { company_name: 'Fall Vitrage', phone: '', address: '' };

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

    // En-tête
    doc.fontSize(22).fillColor('#0f4c81').text(settings.company_name || 'Fall Vitrage', { align: 'left' });
    doc.fontSize(10).fillColor('#333')
      .text(settings.address || '', { align: 'left' })
      .text(settings.phone ? `Tél: ${settings.phone}` : '', { align: 'left' });

    doc.moveDown(1.5);
    doc.fontSize(16).fillColor('#000').text(`Facture N° ${invoiceNumber}`, { align: 'right' });
    doc.fontSize(10).fillColor('#555').text(`Date: ${new Date().toLocaleDateString('fr-FR')}`, { align: 'right' });
    doc.text(`Commande: ${order.order_number}`, { align: 'right' });

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#0f4c81').stroke();
    doc.moveDown(1);

    // Client
    doc.fontSize(12).fillColor('#0f4c81').text('Client');
    doc.fontSize(11).fillColor('#000')
      .text(`Nom: ${order.customer_name}`)
      .text(`Téléphone: ${order.phone}`)
      .text(`Adresse: ${order.address || '-'}`);

    doc.moveDown(1);

    // Détails — une ligne par découpe (produit + dimensions), regroupées
    // dans cette seule commande / seule facture, avec un total unique.
    doc.fontSize(12).fillColor('#0f4c81').text('Détails de la commande');
    doc.fontSize(10).fillColor('#000');

    const colX = { produit: 50, dims: 230, prix: 350, total: 460 };
    const pageBottom = 700;

    function drawTableHeader(y) {
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Produit', colX.produit, y, { width: 170 });
      doc.text('Dimensions', colX.dims, y, { width: 110 });
      doc.text('Prix unit.', colX.prix, y, { width: 100 });
      doc.text('Total', colX.total, y, { width: 85 });
      doc.font('Helvetica');
      doc.moveTo(50, y + 15).lineTo(545, y + 15).strokeColor('#ccc').stroke();
      return y + 24;
    }

    let y = drawTableHeader(doc.y);

    items.forEach((item, index) => {
      if (y > pageBottom) {
        doc.addPage();
        y = drawTableHeader(50);
      }
      doc.fontSize(10);
      doc.text(item.glass_name, colX.produit, y, { width: 170 });
      doc.text(`${item.length_m} m × ${item.width_m} m`, colX.dims, y, { width: 110 });
      doc.text(`${Number(item.unit_price).toLocaleString('fr-FR')} F`, colX.prix, y, { width: 100 });
      doc.text(`${Number(item.line_total).toLocaleString('fr-FR')} F`, colX.total, y, { width: 85 });
      y += 20;
    });

    doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor('#ccc').stroke();
    y += 22;

    if (y > pageBottom - 100) {
      doc.addPage();
      y = 50;
    }

    // Récapitulatif paiement
    doc.fontSize(11);
    doc.text(`Nombre de découpes : ${items.length}`, 50, y);
    y += 22;
    doc.text('Prix total:', 350, y);
    doc.text(`${Number(order.total_price).toLocaleString('fr-FR')} F`, 470, y);
    y += 18;
    doc.text('Montant payé:', 350, y);
    doc.text(`${Number(order.total_paid).toLocaleString('fr-FR')} F`, 470, y);
    y += 18;
    doc.font('Helvetica-Bold');
    doc.text('Reste à payer:', 350, y);
    doc.text(`${Number(order.remaining).toLocaleString('fr-FR')} F`, 470, y);
    doc.font('Helvetica');
    y += 25;

    doc.fontSize(12).fillColor('#0f4c81')
      .text(`Statut du paiement: ${STATUS_LABELS[order.payment_status] || order.payment_status}`, 50, y);

    doc.moveDown(3);
    doc.fontSize(9).fillColor('#888').text('Merci de votre confiance — Fall Vitrage', 50, 750, { align: 'center' });

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
