const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function runMigrations() {
const files = ['001_init.sql', '002_archive_orders.sql', '003_order_items.sql', '004_password_reset.sql', '005_quantity_discount.sql'];
  try {
    for (const file of files) {
      const filePath = path.join(__dirname, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      await pool.query(sql);
      console.log(`Migration exécutée : ${file}`);
    }
    console.log('Toutes les migrations ont été exécutées avec succès.');
  } catch (err) {
    console.error('Erreur lors des migrations:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigrations();
