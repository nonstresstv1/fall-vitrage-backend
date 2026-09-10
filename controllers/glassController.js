const pool = require('../config/db');

// Liste statique utilisée comme fallback immédiat (affichage instantané côté front,
// mais on l'expose aussi ici en secours si la base est momentanément indisponible)
const DEFAULT_PRODUCTS = [
  'Miroir 3 mm',
  'Miroir 5 mm',
  'Verre clair 3 mm',
  'Verre clair 4 mm',
  'Verre clair 5 mm',
  'Stopsol bronze 5 mm'
];

async function list(req, res) {
  try {
    const result = await pool.query(
      'SELECT id, name, price, is_active FROM glass_types WHERE is_active = TRUE ORDER BY id ASC'
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error(err);
    // Secours : renvoyer la liste par défaut sans prix pour ne jamais bloquer l'UI
    res.json({
      products: DEFAULT_PRODUCTS.map((name, i) => ({ id: null, name, price: 0, is_active: true })),
      degraded: true
    });
  }
}

async function updatePrice(req, res) {
  const { id } = req.params;
  const { price } = req.body;

  if (price === undefined || isNaN(price) || Number(price) < 0) {
    return res.status(400).json({ error: 'Prix invalide.' });
  }

  try {
    const result = await pool.query(
      'UPDATE glass_types SET price = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [price, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du prix.' });
  }
}

module.exports = { list, updatePrice, DEFAULT_PRODUCTS };
