-- ============================================================
-- DAROU SALAM MIROIR - Migration 004
-- Ajoute la réinitialisation de mot de passe par email.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash ON users(reset_token_hash);
