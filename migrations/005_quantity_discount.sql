-- ============================================================
-- DAROU SALAM MIROIR - Migration 005
-- Ajoute la quantité par ligne (mêmes dimensions répétées) et
-- la remise sur le total de la commande.
-- ============================================================

-- Quantité de pièces identiques pour une même découpe.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- Montant de la remise accordée (total_price = sous-total - remise).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Met à jour le nom de l'entreprise si le rebranding a été fait après les premiers seeds.
UPDATE settings SET company_name = 'Darou Salam Miroir', updated_at = NOW()
WHERE company_name = 'Fall Vitrage';