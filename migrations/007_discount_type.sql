-- ============================================================
-- DAROU SALAM MIROIR - Migration 007
-- La remise peut cibler les verres, la quincaillerie ou les deux.
-- discount_type : 'all' (commande entière) | 'verre' | 'quincaillerie'
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type VARCHAR(30) NOT NULL DEFAULT 'all';