const pool = require('../config/db');

async function list(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM hardware_products WHERE is_active = TRUE ORDER BY id ASC'
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des produits.' });
  }
}

async function getById(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM hardware_products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement du produit.' });
  }
}

async function create(req, res) {
  const { name, reference, category, description, purchase_price, selling_price, unit, stock_quantity, alert_threshold } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }
  if (selling_price === undefined || isNaN(selling_price) || Number(selling_price) < 0) {
    return res.status(400).json({ error: 'Le prix de vente est requis et doit être positif.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO hardware_products (name, reference, category, description, purchase_price, selling_price, unit, stock_quantity, alert_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name.trim(),
        reference || null,
        category || null,
        description || null,
        Number(purchase_price) || 0,
        Number(selling_price),
        unit || 'piece',
        Number(stock_quantity) || 0,
        Number(alert_threshold) || 0
      ]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du produit.' });
  }
}

async function update(req, res) {
  const { id } = req.params;
  const { name, reference, category, description, purchase_price, selling_price, unit, stock_quantity, alert_threshold } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du produit est requis.' });
  }

  try {
    const result = await pool.query(
      `UPDATE hardware_products
       SET name = $1, reference = $2, category = $3, description = $4,
           purchase_price = $5, selling_price = $6, unit = $7,
           stock_quantity = $8, alert_threshold = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [
        name.trim(),
        reference || null,
        category || null,
        description || null,
        Number(purchase_price) || 0,
        Number(selling_price) || 0,
        unit || 'piece',
        Number(stock_quantity) || 0,
        Number(alert_threshold) || 0,
        id
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du produit.' });
  }
}

async function remove(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE hardware_products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du produit.' });
  }
}

module.exports = { list, getById, create, update, remove };
