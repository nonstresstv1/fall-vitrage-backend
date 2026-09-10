-- ============================================================
-- FALL VITRAGE - Migration 002
-- Ajoute la possibilité de masquer (archiver) une commande de
-- l'historique sans la supprimer, + prépare la suppression définitive.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_orders_archived ON orders(archived);
