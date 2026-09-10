require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const GLASS_TYPES = [
  { name: 'Miroir 3 mm', price: 0 },
  { name: 'Miroir 5 mm', price: 0 },
  { name: 'Verre clair 3 mm', price: 0 },
  { name: 'Verre clair 4 mm', price: 0 },
  { name: 'Verre clair 5 mm', price: 0 },
  { name: 'Stopsol bronze 5 mm', price: 0 }
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Compte admin initial ---
    const adminEmail = process.env.ADMIN_EMAIL || 'damefallvitrage@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'IBZOFALL@';
    const existingAdmin = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);

    if (existingAdmin.rows.length === 0) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'admin', TRUE)`,
        ['Administrateur Fall Vitrage', adminEmail, hash]
      );
      console.log(`Compte admin créé: ${adminEmail}`);
    } else {
      console.log('Compte admin déjà existant, aucune action.');
    }

    // --- Produits (types de verre) ---
    for (const glass of GLASS_TYPES) {
      const existing = await client.query('SELECT id FROM glass_types WHERE name = $1', [glass.name]);
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO glass_types (name, price) VALUES ($1, $2)',
          [glass.name, glass.price]
        );
      }
    }
    console.log('Produits (types de verre) initialisés.');

    // --- Paramètres entreprise ---
    const existingSettings = await client.query('SELECT id FROM settings LIMIT 1');
    if (existingSettings.rows.length === 0) {
      await client.query(
        `INSERT INTO settings (company_name, phone, address)
         VALUES ($1, $2, $3)`,
        ['Fall Vitrage', '', '']
      );
      console.log('Paramètres par défaut créés.');
    }

    await client.query('COMMIT');
    console.log('Seed terminé avec succès.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur lors du seed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
