const pool = require('../config/db');

async function addPayment(req, res) {
  const { order_id, amount, method } = req.body;

  if (!order_id || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order_id]);
    const order = orderResult.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    const paidResult = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE order_id = $1', [order_id]
    );
    const alreadyPaid = Number(paidResult.rows[0].total_paid);
    const remaining = Number(order.total_price) - alreadyPaid;

    if (Number(amount) > remaining + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Le montant dépasse le reste à payer (${remaining.toFixed(2)}).`
      });
    }

    await client.query(
      'INSERT INTO payments (order_id, amount, method, recorded_by) VALUES ($1, $2, $3, $4)',
      [order_id, amount, method || 'especes', req.user.id]
    );

    const newPaid = alreadyPaid + Number(amount);
    let paymentStatus = 'partiel';
    if (newPaid <= 0) paymentStatus = 'non_paye';
    else if (newPaid >= Number(order.total_price) - 0.01) paymentStatus = 'paye';

    const updated = await client.query(
      'UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [paymentStatus, order_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ order: updated.rows[0], total_paid: newPaid });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du paiement." });
  } finally {
    client.release();
  }
}

async function listByOrder(req, res) {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at ASC', [orderId]
    );
    res.json({ payments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des paiements.' });
  }
}

module.exports = { addPayment, listByOrder };
