-- ============================================================
-- DAROU SALAM MIROIR - Migration initiale
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'employe')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS glass_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  address VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(30) UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  glass_type_id INTEGER NOT NULL REFERENCES glass_types(id),
  length_m NUMERIC(10,3) NOT NULL,
  width_m NUMERIC(10,3) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,      -- prix snapshot au moment de la commande
  total_price NUMERIC(12,2) NOT NULL,     -- longueur * largeur * unit_price
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'en_cours', 'termine', 'annule')),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'non_paye'
    CHECK (payment_status IN ('non_paye', 'partiel', 'paye')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(30) DEFAULT 'especes',
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(150) NOT NULL DEFAULT 'Darou Salam Miroir',
  phone VARCHAR(30),
  address VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(30) UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
