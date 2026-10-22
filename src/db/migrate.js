// src/db/migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // 1. Create a table to track which migrations have run
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read all .sql files from the migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Check if the directory exists first
    if (!fs.existsSync(migrationsDir)) {
      console.error(`❌ Directory not found: ${migrationsDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sorts alphabetically (001_, 002_, etc.)

    // 3. Loop through files and execute unapplied ones
    for (const file of files) {
      const { rows } = await client.query('SELECT id FROM schema_migrations WHERE id = $1', [file]);
      
      if (rows.length === 0) {
        console.log(`⏳ Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`✅ Successfully applied: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌ Error in ${file}:`, err.message);
          throw err;
        }
      } else {
        // Optional: Log that it's already applied (can comment out to reduce noise)
        // console.log(`⏭️  Skipping (already applied): ${file}`);
      }
    }
    console.log('🎉 All migrations are up to date!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigrations();