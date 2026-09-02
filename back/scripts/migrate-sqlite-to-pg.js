/**
 * Script de migrare: SQLite (clinica.db) -> PostgreSQL
 *
 * Utilizare:
 *   1. Instaleaza PostgreSQL si creeaza baza de date (ex: clinica)
 *   2. Copiaza .env.example in .env si completeaza credentialele
 *   3. Ruleaza: npm run migrate
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Pool } = require('pg');

const SQLITE_PATH = path.join(__dirname, '..', 'clinica.db');
const PG_SCHEMA_PATH = path.join(__dirname, '..', 'queries-pg.sql');

const TABLES = [
  { name: 'pacient', pk: 'id_pacient' },
  { name: 'medic', pk: 'id_medic' },
  { name: 'programare', pk: 'id_programare' },
  { name: 'consultatie', pk: 'id_consultatie' },
  { name: 'fisa_medicala', pk: 'id_fisa' },
  { name: 'feedback', pk: 'id_feedback' },
  { name: 'statistica', pk: 'id_statistica' },
  { name: 'coada_asteptare', pk: 'id' }
];

const BOOLEAN_COLUMNS = {
  pacient: ['gen'],
  medic: ['disponibilitate']
};

function normalizeValue(table, column, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (BOOLEAN_COLUMNS[table]?.includes(column)) {
    if (value === 0 || value === '0') return false;
    if (value === 1 || value === '1') return true;
  }

  return value;
}

async function getSqliteColumns(sqliteDb, table) {
  const info = await sqliteDb.all(`PRAGMA table_info(${table})`);
  return info.map((col) => col.name);
}

async function getPgColumns(pgPool, table) {
  const result = await pgPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function resetSequence(pgPool, table, pk) {
  const seqResult = await pgPool.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [table, pk]);
  const seq = seqResult.rows[0]?.seq;
  if (!seq) return;

  await pgPool.query(
    `SELECT setval($1, COALESCE((SELECT MAX(${pk}) FROM ${table}), 1), true)`,
    [seq]
  );
}

async function migrateTable(sqliteDb, pgPool, tableName, pk) {
  const sqliteCols = await getSqliteColumns(sqliteDb, tableName);
  const pgCols = await getPgColumns(pgPool, tableName);
  const columns = sqliteCols.filter((col) => pgCols.includes(col));

  if (columns.length === 0) {
    console.log(`  [skip] ${tableName}: nici o coloana comuna`);
    return 0;
  }

  const rows = await sqliteDb.all(`SELECT * FROM ${tableName}`);
  if (rows.length === 0) {
    console.log(`  [ok] ${tableName}: 0 randuri`);
    return 0;
  }

  const colList = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((col) => normalizeValue(tableName, col, row[col]));
    await pgPool.query(insertSql, values);
  }

  await resetSequence(pgPool, tableName, pk);
  console.log(`  [ok] ${tableName}: ${rows.length} randuri migrate`);
  return rows.length;
}

async function clearPostgresTables(pgPool) {
  const tableNames = TABLES.map((t) => t.name).reverse().join(', ');
  await pgPool.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
}

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`Fisierul SQLite nu exista: ${SQLITE_PATH}`);
    process.exit(1);
  }

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
  });

  const sqliteDb = await open({
    filename: SQLITE_PATH,
    driver: sqlite3.Database
  });

  try {
    console.log('Conectare la PostgreSQL...');
    await pgPool.query('SELECT 1');

    console.log('Creare schema PostgreSQL...');
    const schema = fs.readFileSync(PG_SCHEMA_PATH, 'utf8');
    await pgPool.query(schema);

    console.log('Golire tabele PostgreSQL inainte de migrare...');
    await clearPostgresTables(pgPool);

    console.log('Migrare date din SQLite...');
    let total = 0;
    for (const table of TABLES) {
      total += await migrateTable(sqliteDb, pgPool, table.name, table.pk);
    }

    console.log('');
    console.log(`Migrare finalizata cu succes! Total: ${total} randuri.`);
    console.log('Actualizeaza .env cu credentialele PostgreSQL si porneste serverul cu: npm start');
  } catch (error) {
    console.error('Eroare la migrare:', error.message);
    process.exit(1);
  } finally {
    await sqliteDb.close();
    await pgPool.end();
  }
}

main();
