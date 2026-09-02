require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { convertSql, addReturningForInsert } = require('./sqlCompat');

let db = null;
let pool = null;

function createPgWrapper(pgPool) {
  return {
    async get(sql, params = []) {
      const { text, values } = convertSql(sql, params);
      const result = await pgPool.query(text, values);
      return result.rows[0];
    },

    async all(sql, params = []) {
      const { text, values } = convertSql(sql, params);
      const result = await pgPool.query(text, values);
      return result.rows;
    },

    async run(sql, params = []) {
      let { text, values } = convertSql(sql, params);
      text = addReturningForInsert(text);

      const result = await pgPool.query(text, values);
      let lastID;

      if (/^\s*INSERT\s+INTO/i.test(text) && result.rows[0]) {
        lastID = Object.values(result.rows[0])[0];
      }

      return { lastID, changes: result.rowCount };
    },

    async exec(sql) {
      const { text } = convertSql(sql, []);
      await pgPool.query(text);
    }
  };
}

const startDatabase = async () => {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

    await pool.query('SELECT 1');

    const queries = fs.readFileSync(path.join(__dirname, 'queries-pg.sql'), 'utf8');
    await pool.query(queries);

    db = createPgWrapper(pool);
    console.log('Baza de date PostgreSQL a fost initializata cu succes');
    return true;
  } catch (error) {
    console.log('Eroare in stabilirea conexiunii cu baza de date: ' + error.message);
    return false;
  }
};

const getDb = () => db;

async function testDatabaseInfo() {
  try {
    if (!db) await startDatabase();
    console.log('=== TEST CONSULTATII ===');
    const allConsultatii = await db.all('SELECT * FROM consultatie');
    console.log('Toate consultatiile:', allConsultatii.length);
    if (allConsultatii.length > 0) {
      console.log('Prima consultatie:', allConsultatii[0]);
    }
    const medicSchema = await db.all(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'medic'
      ORDER BY ordinal_position
    `);
    console.log('Structura tabela medic:', medicSchema);
    const medici = await db.all('SELECT * FROM medic');
    console.log('Medici in baza de date:', medici.length);
    if (medici.length > 0) {
      console.log('Primul medic:', medici[0]);
    }
    const pacientId = 1;
    const consultatiiPacient = await db.all(`
      SELECT
        c.*,
        m.nume as nume_medic,
        m.specializare
      FROM consultatie c
      JOIN medic m ON c.id_medic = m.id_medic
      WHERE c.id_pacient = ?
    `, [pacientId]);
    console.log(`Consultatii pentru pacientul ${pacientId}:`, consultatiiPacient.length);
    if (consultatiiPacient.length > 0) {
      console.log('Prima consultatie a pacientului:', consultatiiPacient[0]);
    }
  } catch (err) {
    console.error('Eroare testDatabaseInfo:', err);
  }
}

module.exports = { startDatabase, getDb, testDatabaseInfo };
