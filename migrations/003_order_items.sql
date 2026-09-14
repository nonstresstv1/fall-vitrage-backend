-- ============================================================
-- DAROU SALAM MIROIR - Migration 003
-- Permet à une commande de contenir PLUSIEURS lignes (produit +
-- dimensions), pour regrouper plusieurs découpes d'un même client
-- dans une seule commande / une seule facture avec un total unique.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  glass_type_id INTEGER NOT NULL REFERENCES glass_types(id),
  length_m NUMERIC(10,3) NOT NULL,
  width_m NUMERIC(10,3) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,   -- prix snapshot au moment de la commande
  line_total NUMERIC(12,2) NOT NULL,   -- longueur * largeur * unit_price (règle obligatoire)
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Reprend les commandes existantes (créées avant ce changement) et les
-- transforme en une commande à une seule ligne, pour ne rien perdre.
INSERT INTO order_items (order_id, glass_type_id, length_m, width_m, unit_price, line_total)
SELECT id, glass_type_id, length_m, width_m, unit_price, total_price
FROM orders
WHERE glass_type_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_items.order_id = orders.id);

-- Les anciennes colonnes ne sont plus utilisées pour la création de
-- commandes (remplacées par order_items), on les rend optionnelles
-- plutôt que de les supprimer, pour ne rien casser rétroactivement.
ALTER TABLE orders ALTER COLUMN glass_type_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN length_m DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN width_m DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN unit_price DROP NOT NULL;
