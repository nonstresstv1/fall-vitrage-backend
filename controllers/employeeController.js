const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function list(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, is_active, created_at
       FROM users WHERE role = 'employe' ORDER BY created_at DESC`
    );
    res.json({ employees: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des employés.' });
  }
}

async function create(req, res) {
  const { full_name, email, password } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'employe', TRUE)
       RETURNING id, full_name, email, role, is_active, created_at`,
      [full_name, email.toLowerCase().trim(), hash]
    );

    res.status(201).json({ employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'employé." });
  }
}

async function toggleActive(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active
       WHERE id = $1 AND role = 'employe'
       RETURNING id, full_name, email, role, is_active`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employé introuvable.' });
    }
    res.json({ employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'employé." });
  }
}

module.exports = { list, create, toggleActive };
