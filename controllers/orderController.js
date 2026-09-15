const pool = require('../config/db');

function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FV-${y}${m}${d}-${rand}`;
}

// RÈGLE MÉTIER OBLIGATOIRE : Prix Total ligne = Quantité x Longueur x Largeur x Prix
// (jamais prix au m²). La quantité = nombre de pièces identiques à cette dimension.
function computeTotal(length_m, width_m, unit_price, quantity = 1) {
  return Math.round(Number(length_m) * Number(width_m) * Number(unit_price) * Number(quantity) * 100) / 100;
}

async function create(req, res) {
  const { customer_name, phone, address, items, hardware_items, discount, discount_type } = req.body;

  if (!customer_name || !phone) {
    return res.status(400).json({ error: 'Nom et téléphone du client requis.' });
  }
  const hasGlassItems = Array.isArray(items) && items.length > 0;
  const hasHardwareItems = Array.isArray(hardware_items) && hardware_items.length > 0;
  if (!hasGlassItems && !hasHardwareItems) {
    return res.status(400).json({ error: 'Ajoutez au moins une ligne (verre ou quincaillerie).' });
  }
  if (hasGlassItems) {
    for (const item of items) {
      if (!item.glass_type_id || !item.length_m || !item.width_m) {
        return res.status(400).json({ error: 'Chaque ligne de verre doit avoir un produit et des dimensions.' });
      }
      if (Number(item.length_m) <= 0 || Number(item.width_m) <= 0) {
        return res.status(400).json({ error: 'Les dimensions doivent être positives.' });
      }
      const qty = item.quantity === undefined || item.quantity === null ? 1 : Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'La quantité de chaque ligne doit être un nombre positif.' });
      }
    }
  }
  if (hasHardwareItems) {
    for (const hItem of hardware_items) {
      if (!hItem.hardware_product_id || !hItem.quantity) {
        return res.status(400).json({ error: 'Chaque ligne de quincaillerie doit avoir un produit et une quantité.' });
      }
      if (Number(hItem.quantity) <= 0) {
        return res.status(400).json({ error: 'La quantité de quincaillerie doit être positive.' });
      }
    }
  }
  const discountValue = discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
  if (isNaN(discountValue) || discountValue < 0) {
    return res.status(400).json({ error: 'La remise doit être un montant positif ou nul.' });
  }
  const discountType = ['all', 'verre', 'quincaillerie'].includes(discount_type) ? discount_type : 'all';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const customerResult = await client.query(
      'INSERT INTO customers (full_name, phone, address) VALUES ($1, $2, $3) RETURNING id',
      [customer_name, phone, address || null]
    );
    const customerId = customerResult.rows[0].id;

    const orderNumber = generateOrderNumber();

    const resolvedItems = [];
    const resolvedHardwareItems = [];
    let glassSubtotal = 0;
    let hardwareSubtotal = 0;

    if (hasGlassItems) {
      for (const item of items) {
        const glassResult = await client.query('SELECT * FROM glass_types WHERE id = $1', [item.glass_type_id]);
        const glass = glassResult.rows[0];
        if (!glass) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Produit introuvable (id ${item.glass_type_id}).` });
        }
        const qty = item.quantity === undefined || item.quantity === null ? 1 : item.quantity;
        const lineTotal = computeTotal(item.length_m, item.width_m, glass.price, qty);
        glassSubtotal += lineTotal;
        resolvedItems.push({
          glass_type_id: item.glass_type_id,
          length_m: item.length_m,
          width_m: item.width_m,
          quantity: qty,
          unit_price: glass.price,
          line_total: lineTotal
        });
      }
    }

    if (hasHardwareItems) {
      for (const hItem of hardware_items) {
        const hwResult = await client.query('SELECT * FROM hardware_products WHERE id = $1 AND is_active = TRUE', [hItem.hardware_product_id]);
        const hw = hwResult.rows[0];
        if (!hw) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Produit de quincaillerie introuvable (id ${hItem.hardware_product_id}).` });
        }
        const qty = Number(hItem.quantity);
        const unitPrice = Number(hw.selling_price);
        const lineTotal = Math.round(qty * unitPrice * 100) / 100;
        hardwareSubtotal += lineTotal;
        resolvedHardwareItems.push({
          hardware_product_id: hw.id,
          quantity: qty,
          unit: hItem.unit || hw.unit,
          unit_price: unitPrice,
          line_total: lineTotal
        });
      }
    }

    const subtotal = Math.round((glassSubtotal + hardwareSubtotal) * 100) / 100;
    // La remise est plafonnée au sous-total de la catégorie choisie :
    // 'all' => toute la commande, 'verre' => verres seuls,
    // 'quincaillerie' => quincaillerie seule.
    let discountMax = subtotal;
    if (discountType === 'verre') discountMax = glassSubtotal;
    else if (discountType === 'quincaillerie') discountMax = hardwareSubtotal;
    discountMax = Math.round(discountMax * 100) / 100;
    const appliedDiscount = Math.min(Math.round(discountValue * 100) / 100, discountMax);
    const totalPrice = Math.round((subtotal - appliedDiscount) * 100) / 100;

    const orderResult = await client.query(
      `INSERT INTO orders
        (order_number, customer_id, total_price, status, payment_status, created_by, discount, discount_type)
       VALUES ($1, $2, $3, 'en_attente', 'non_paye', $4, $5, $6)
       RETURNING *`,
      [orderNumber, customerId, totalPrice, req.user.id, appliedDiscount, discountType]
    );
    const order = orderResult.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, glass_type_id, length_m, width_m, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.glass_type_id, item.length_m, item.width_m, item.quantity, item.unit_price, item.line_total]
      );
    }

    for (const hItem of resolvedHardwareItems) {
      await client.query(
        `INSERT INTO order_hardware_items (order_id, hardware_product_id, quantity, unit, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, hItem.hardware_product_id, hItem.quantity, hItem.unit, hItem.unit_price, hItem.line_total]
      );
      // Décrémenter le stock
      await client.query(
        'UPDATE hardware_products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2',
        [hItem.quantity, hItem.hardware_product_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ order, items: resolvedItems, hardware_items: resolvedHardwareItems });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  } finally {
    client.release();
  }
}

async function list(req, res) {
  const showArchived = req.query.archived === 'true';

  try {
    const result = await pool.query(`
      SELECT o.*, c.full_name AS customer_name, c.phone, c.address,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS total_paid,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
             (SELECT COUNT(*) FROM order_hardware_items ohi WHERE ohi.order_id = o.id) AS hardware_item_count,
             (SELECT string_agg(g.name, ', ') FROM order_items oi
                JOIN glass_types g ON g.id = oi.glass_type_id WHERE oi.order_id = o.id) AS glass_names,
             (SELECT string_agg(hp.name, ', ') FROM order_hardware_items ohi
                JOIN hardware_products hp ON hp.id = ohi.hardware_product_id WHERE ohi.order_id = o.id) AS hardware_names
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

    const hardwareItems = await pool.query(`
      SELECT ohi.*, hp.name AS hardware_name, hp.reference AS hardware_reference
      FROM order_hardware_items ohi
      JOIN hardware_products hp ON hp.id = ohi.hardware_product_id
      WHERE ohi.order_id = $1
      ORDER BY ohi.id ASC
    `, [id]);

    const payments = await pool.query(
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at ASC', [id]
    );

    res.json({ order: result.rows[0], items: items.rows, hardware_items: hardwareItems.rows, payments: payments.rows });
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

      // Restituer le stock des produits de quincaillerie de la commande.
      const hwResult = await client.query(
        'SELECT hardware_product_id, quantity FROM order_hardware_items WHERE order_id = $1',
        [id]
      );
      for (const hw of hwResult.rows) {
        await client.query(
          'UPDATE hardware_products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2',
          [Number(hw.quantity), hw.hardware_product_id]
        );
      }
    }

    const paymentStatus = status === 'annule' ? 'non_paye' : existing.payment_status;

    // Réactivation d'une commande annulée : on redécrémente le stock.
    if (existing.status === 'annule' && status !== 'annule') {
      const hwResult = await client.query(
        'SELECT hardware_product_id, quantity FROM order_hardware_items WHERE order_id = $1',
        [id]
      );
      for (const hw of hwResult.rows) {
        await client.query(
          'UPDATE hardware_products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2',
          [Number(hw.quantity), hw.hardware_product_id]
        );
      }
    }

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

    const existing = await client.query('SELECT id, status FROM orders WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    await client.query('DELETE FROM invoices WHERE order_id = $1', [id]);
    await client.query('DELETE FROM payments WHERE order_id = $1', [id]);

    // Restituer le stock de quincaillerie avant suppression (sauf si la
    // commande était déjà annulée : le stock a déjà été restitué à ce moment).
    if (existing.rows[0].status !== 'annule') {
      const hwResult = await client.query(
        'SELECT hardware_product_id, quantity FROM order_hardware_items WHERE order_id = $1',
        [id]
      );
      for (const hw of hwResult.rows) {
        await client.query(
          'UPDATE hardware_products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2',
          [Number(hw.quantity), hw.hardware_product_id]
        );
      }
    }

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
