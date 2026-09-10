const pool = require('../config/db');

async function get(req, res) {
  try {
    const result = await pool.query('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
    res.json({ settings: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des paramètres.' });
  }
}

async function update(req, res) {
  const { company_name, phone, address } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM settings ORDER BY id ASC LIMIT 1');
    let result;
    if (existing.rows.length === 0) {
      result = await pool.query(
        `INSERT INTO settings (company_name, phone, address) VALUES ($1, $2, $3) RETURNING *`,
        [company_name || 'Fall Vitrage', phone || '', address || '']
      );
    } else {
      result = await pool.query(
        `UPDATE settings SET company_name = $1, phone = $2, address = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [company_name || 'Fall Vitrage', phone || '', address || '', existing.rows[0].id]
      );
    }
    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des paramètres.' });
  }
}

module.exports = { get, update };
