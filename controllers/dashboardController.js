const pool = require('../config/db');

// Statistiques financières -> réservé à l'admin (vérifié par le routeur)
async function stats(req, res) {
  try {
    // Jointure avec orders + exclusion des commandes annulées : une commande
    // annulée ne doit jamais compter dans le chiffre d'affaires, même si
    // d'anciens paiements existaient avant l'annulation.
    const todayResult = await pool.query(`
      SELECT COALESCE(SUM(p.amount), 0) AS total
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.created_at::date = CURRENT_DATE
        AND o.status != 'annule'
    `);

    const monthResult = await pool.query(`
      SELECT COALESCE(SUM(p.amount), 0) AS total
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE date_trunc('month', p.created_at) = date_trunc('month', CURRENT_DATE)
        AND o.status != 'annule'
    `);

    const ordersCountResult = await pool.query('SELECT COUNT(*) AS total FROM orders');
    const pendingResult = await pool.query(
      "SELECT COUNT(*) AS total FROM orders WHERE status = 'en_attente'"
    );

    const recentOrders = await pool.query(`
      SELECT o.id, o.order_number, o.total_price, o.status, o.payment_status, o.created_at,
             c.full_name AS customer_name, g.name AS glass_name
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN glass_types g ON g.id = o.glass_type_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);

    res.json({
      today_revenue: Number(todayResult.rows[0].total),
      month_revenue: Number(monthResult.rows[0].total),
      orders_count: Number(ordersCountResult.rows[0].total),
      pending_orders: Number(pendingResult.rows[0].total),
      recent_orders: recentOrders.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des statistiques.' });
  }
}

// Vue limitée pour les employés : pas de chiffres financiers
async function summary(req, res) {
  try {
    const ordersCountResult = await pool.query('SELECT COUNT(*) AS total FROM orders');
    const pendingResult = await pool.query(
      "SELECT COUNT(*) AS total FROM orders WHERE status = 'en_attente'"
    );
    const recentOrders = await pool.query(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.created_at,
             c.full_name AS customer_name, g.name AS glass_name
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN glass_types g ON g.id = o.glass_type_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);

    res.json({
      orders_count: Number(ordersCountResult.rows[0].total),
      pending_orders: Number(pendingResult.rows[0].total),
      recent_orders: recentOrders.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement du résumé.' });
  }
}

module.exports = { stats, summary };
