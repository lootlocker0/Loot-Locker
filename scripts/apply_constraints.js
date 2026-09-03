#!/usr/bin/env node
const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const sqlPath = 'prisma/migrations/manual_constraints.sql';
  if (!fs.existsSync(sqlPath)) {
    console.error('manual_constraints.sql not found at', sqlPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DIRECT_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Applied manual constraints');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Failed to apply constraints:', e.message || e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
