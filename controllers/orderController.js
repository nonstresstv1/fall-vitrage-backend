const pool = require('../config/db');

function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FV-${y}${m}${d}-${rand}`;
}

// RÈGLE MÉTIER OBLIGATOIRE : Prix Total = Longueur x Largeur x Prix (jamais prix au m²)
function computeTotal(length_m, width_m, unit_price) {
  return Math.round(Number(length_m) * Number(width_m) * Number(unit_price) * 100) / 100;
}

async function create(req, res) {
  const { customer_name, phone, address, items } = req.body;

  if (!customer_name || !phone) {
    return res.status(400).json({ error: 'Nom et téléphone du client requis.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Ajoutez au moins une ligne (produit + dimensions).' });
  }
  for (const item of items) {
    if (!item.glass_type_id || !item.length_m || !item.width_m) {
      return res.status(400).json({ error: 'Chaque ligne doit avoir un produit et des dimensions.' });
    }
    if (Number(item.length_m) <= 0 || Number(item.width_m) <= 0) {
      return res.status(400).json({ error: 'Les dimensions doivent être positives.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const customerResult = await client.query(
      'INSERT INTO customers (full_name, phone, address) VALUES ($1, $2, $3) RETURNING id',
      [customer_name, phone, address || null]
    );
    const customerId = customerResult.rows[0].id;

    const orderNumber = generateOrderNumber();

    // On calcule d'abord chaque ligne (règle obligatoire : Longueur x Largeur x Prix),
    // puis le total de la commande = somme de toutes les lignes.
    const resolvedItems = [];
    let totalPrice = 0;

    for (const item of items) {
      const glassResult = await client.query('SELECT * FROM glass_types WHERE id = $1', [item.glass_type_id]);
      const glass = glassResult.rows[0];
      if (!glass) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Produit introuvable (id ${item.glass_type_id}).` });
      }
      const lineTotal = computeTotal(item.length_m, item.width_m, glass.price);
      totalPrice += lineTotal;
      resolvedItems.push({
        glass_type_id: item.glass_type_id,
        length_m: item.length_m,
        width_m: item.width_m,
        unit_price: glass.price,
        line_total: lineTotal
      });
    }
    totalPrice = Math.round(totalPrice * 100) / 100;

    const orderResult = await client.query(
      `INSERT INTO orders
        (order_number, customer_id, total_price, status, payment_status, created_by)
       VALUES ($1, $2, $3, 'en_attente', 'non_paye', $4)
       RETURNING *`,
      [orderNumber, customerId, totalPrice, req.user.id]
    );
    const order = orderResult.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, glass_type_id, length_m, width_m, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.glass_type_id, item.length_m, item.width_m, item.unit_price, item.line_total]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ order, items: resolvedItems });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  } finally {
    client.release();
  }
}

async function list(req, res) {
  // Par défaut, l'historique masqué (archivé) n'apparaît pas dans la liste
  // principale. ?archived=true permet de consulter les commandes masquées.
  const showArchived = req.query.archived === 'true';

  try {
    const result = await pool.query(`
      SELECT o.*, c.full_name AS customer_name, c.phone, c.address,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS total_paid,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
             (SELECT string_agg(g.name, ', ') FROM order_items oi
                JOIN glass_types g ON g.id = oi.glass_type_id WHERE oi.order_id = o.id) AS glass_names
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.archived = $1
      ORDER BY o.created_at DESC
    `, [showArchived]);
    res.json({ orders: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des commandes.' });
  }
}

async function getById(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT o.*, c.full_name AS customer_name, c.phone, c.address,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS total_paid
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    const items = await pool.query(`
      SELECT oi.*, g.name AS glass_name
      FROM order_items oi
      JOIN glass_types g ON g.id = oi.glass_type_id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
    `, [id]);

    const payments = await pool.query(
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at ASC', [id]
    );

    res.json({ order: result.rows[0], items: items.rows, payments: payments.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement de la commande.' });
  }
}

async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['en_attente', 'en_cours', 'termine', 'annule'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const existing = existingResult.rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    let refundedAmount = 0;

    // Annuler une commande la retire automatiquement du chiffre d'affaires :
    // tout paiement déjà enregistré est remboursé (supprimé) et le statut de
    // paiement repasse à "non payé", pour que le dashboard ne compte plus
    // jamais l'argent d'une commande annulée.
    if (status === 'annule') {
      const paidResult = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE order_id = $1',
        [id]
      );
      refundedAmount = Number(paidResult.rows[0].total_paid);

      await client.query('DELETE FROM payments WHERE order_id = $1', [id]);
    }

    const paymentStatus = status === 'annule' ? 'non_paye' : existing.payment_status;

    const result = await client.query(
      'UPDATE orders SET status = $1, payment_status = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [status, paymentStatus, id]
    );

    await client.query('COMMIT');
    res.json({ order: result.rows[0], refunded_amount: refundedAmount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  } finally {
    client.release();
  }
}

// Masquer / réafficher une commande de l'historique (réversible, réservé admin).
// Ne touche ni aux paiements ni aux statistiques : purement un affichage.
async function setArchived(req, res) {
  const { id } = req.params;
  const { archived } = req.body;

  try {
    const result = await pool.query(
      `UPDATE orders
       SET archived = $1, archived_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING *`,
      [Boolean(archived), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }
    res.json({ order: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
}

// Suppression DÉFINITIVE d'une commande (réservée admin, irréversible).
// Supprime en cascade ses paiements et factures associées.
async function remove(req, res) {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM orders WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    await client.query('DELETE FROM invoices WHERE order_id = $1', [id]);
    await client.query('DELETE FROM payments WHERE order_id = $1', [id]);
    await client.query('DELETE FROM orders WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  } finally {
    client.release();
  }
}

module.exports = { create, list, getById, updateStatus, computeTotal, setArchived, remove };
