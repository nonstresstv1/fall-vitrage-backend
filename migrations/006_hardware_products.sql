-- ============================================================
-- DAROU SALAM MIROIR - Migration 006
-- Produits de quincaillerie + lignes de commande quincaillerie
-- ============================================================

CREATE TABLE IF NOT EXISTS hardware_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  reference VARCHAR(50),
  category VARCHAR(100),
  description TEXT,
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit VARCHAR(30) NOT NULL DEFAULT 'piece',
  stock_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  alert_threshold NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_hardware_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  hardware_product_id INTEGER NOT NULL REFERENCES hardware_products(id),
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT 'piece',
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_hardware_order_id ON order_hardware_items(order_id);
CREATE INDEX IF NOT EXISTS idx_hardware_products_active ON hardware_products(is_active);
