/*const { startDatabase, getDb } = require('./db');

async function testDatabase() {
  try {
    console.log('Starting database test...');
    
    // Inițializează baza de date
    const connected = await startDatabase();
    console.log('Database connected:', connected);
    
    if (!connected) {
      console.error('Could not connect to database');
      return;
    }
    
    // Obține instanța bazei de date
    const db = getDb();
    console.log('Database instance:', db ? 'OK' : 'NULL');
    
    if (!db) {
      console.error('getDb() returned null');
      return;
    }
    
    // Testează o query simplă
    const result = await db.get('SELECT COUNT(*) as count FROM programare');
    console.log('Programări count:', result);
    
    // Testează query-ul pentru medicul 1
    const programari = await db.all(`
      SELECT p.id_programare, p.data, p.ora, p.status, p.detalii,
             pa.nume || ' ' || pa.prenume as nume_pacient,
             pa.telefon
      FROM programare p
      LEFT JOIN pacient pa ON p.id_pacient = pa.id_pacient
      WHERE p.id_medic = 1
      ORDER BY p.data DESC, p.ora DESC
    `);
    
    console.log('Programări pentru medicul 1:', programari.length);
    if (programari.length > 0) {
      console.log('Prima programare:', programari[0]);
    }
    
  } catch (err) {
    console.error('Error in test:', err);
  }
}

testDatabase(); 
const sqlite3 = require('sqlite3').verbose();

// Creează o bază de date temporară în memorie
let db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error('Eroare la deschiderea bazei de date:', err.message);
  }
  console.log('Conexiune SQLite creată cu succes!');
});

// Închide baza de date
db.close((err) => {
  if (err) {
    return console.error('Eroare la închidere:', err.message);
  }
  console.log('Conexiune închisă.');
});
*/

