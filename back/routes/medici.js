const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// Medici disponibili pentru o specializare, dată și oră
router.get('/disponibili', async (req, res) => {
  const { specializare, data, ora } = req.query;
  try {
    const rows = await getDb().all(
      `SELECT m.id_medic AS id, m.nume, m.rating
       FROM medic m
       WHERE m.specializare = ?
       AND m.disponibilitate = 1
       AND NOT EXISTS (
         SELECT 1 FROM programare p
         WHERE p.id_medic = m.id_medic AND p.data = ? AND p.ora = ? AND p.status != 'anulata'
       )`,
      [specializare, data, ora]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Eroare la obținerea medicilor disponibili" });
  }
});

// Specializări distincte din baza de date
router.get('/specializari', async (req, res) => {
  try {
    const rows = await getDb().all(
      `SELECT DISTINCT specializare FROM medic`
    );
    const specializari = rows.map(r => r.specializare);
    res.json(specializari);
  } catch (err) {
    console.error("❌ Eroare la extragerea specializărilor:", err);
    res.status(500).json({ message: "Eroare server la extragerea specializărilor" });
  }
});

// Timpul mediu de consultatie pentru un medic
router.get('/timp-mediu/:id_medic', async (req, res) => {
  try {
    // Încercăm să luăm din statistica, dacă nu există, calculăm din consultatii
    const stat = await getDb().get(
      `SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? ORDER BY data DESC LIMIT 1`,
      [req.params.id_medic]
    );
    if (stat && stat.durata_medie_consultatie) {
      return res.json({ durata_medie: stat.durata_medie_consultatie });
    }
    // Dacă nu există în statistica, calculăm din consultatii
    const consult = await getDb().get(
      `SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata IS NOT NULL`,
      [req.params.id_medic]
    );
    res.json({ durata_medie: consult.durata_medie || 30 }); // fallback 30 min
  } catch (err) {
    res.status(500).json({ message: 'Eroare la calculul timpului mediu', error: err.message });
  }
});

// Medici pentru o specializare (fără verificarea disponibilității)
router.get('/specializare', async (req, res) => {
  const { specializare } = req.query;
  try {
    const rows = await getDb().all(
      `SELECT id_medic, nume, rating, specializare
       FROM medic
       WHERE specializare = ? AND disponibilitate = 1
       ORDER BY nume ASC`,
      [specializare]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Eroare la obținerea medicilor pentru specializare" });
  }
});

// Ore disponibile pentru un medic într-o zi
router.get('/ore-disponibile', async (req, res) => {
  const { medic, data } = req.query;
  try {
    // Generăm toate orele posibile între 07:00 și 20:30
    const orePosibile = [];
    for (let h = 7; h <= 20; h++) {
      ["00", "30"].forEach(m => {
        const ora = `${h.toString().padStart(2, '0')}:${m}`;
        orePosibile.push(ora);
      });
    }
    // Adaug și 20:30
    orePosibile.push("20:30");

    // Obținem orele ocupate pentru medicul respectiv în ziua respectivă
    const oreOcupate = await getDb().all(
      `SELECT ora FROM programare 
       WHERE id_medic = ? AND data = ? AND status != 'anulata'
       ORDER BY ora ASC`,
      [medic, data]
    );

    // Filtrăm orele disponibile
    const oreOcupateArray = oreOcupate.map(row => row.ora);
    const oreDisponibile = orePosibile.filter(ora => !oreOcupateArray.includes(ora));

    console.log(`Ore disponibile pentru medicul ${medic} în data ${data}:`, oreDisponibile);
    res.json(oreDisponibile);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Eroare la obținerea orelor disponibile" });
  }
});

// Verifică disponibilitatea unui medic la o anumită oră
router.get('/verifica-disponibilitate', async (req, res) => {
  const { medic, data, ora } = req.query;
  try {
    const programare = await getDb().get(
      `SELECT id_programare FROM programare 
       WHERE id_medic = ? AND data = ? AND ora = ? AND status != 'anulata'`,
      [medic, data, ora]
    );

    if (programare) {
      res.status(409).json({ message: "Medicul nu este disponibil la această oră" });
    } else {
      res.json({ message: "Medicul este disponibil la această oră" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Eroare la verificarea disponibilității" });
  }
});

// Pacienți consultați de un medic
router.get('/consultati/:id_medic', async (req, res) => {
  try {
    const rows = await getDb().all(
      `SELECT DISTINCT p.id_pacient, p.nume, p.prenume, p.email, p.telefon
       FROM pacient p
       JOIN consultatie c ON p.id_pacient = c.id_pacient
       WHERE c.id_medic = ?
       ORDER BY p.nume, p.prenume`,
      [req.params.id_medic]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Eroare la încărcarea pacienților consultați', error: err.message });
  }
});

// Statistici complexe pentru un medic
router.get('/statistici/:id_medic', async (req, res) => {
  const db = getDb();
  const id_medic = req.params.id_medic;
  try {
    console.log(`[STAT MEDIC] Ruta /statistici/${id_medic} a fost apelată!`);
    // 1. Număr total consultații
    const totalConsultatii = (await db.get('SELECT COUNT(*) as nr FROM consultatie WHERE id_medic = ?', [id_medic])).nr;
    // 2. Număr pacienți unici
    const pacientiUnici = (await db.get('SELECT COUNT(DISTINCT id_pacient) as nr FROM consultatie WHERE id_medic = ?', [id_medic])).nr;
    // 3. Programări anulate/neprezentate
    const anulate = (await db.get(`SELECT COUNT(*) as nr FROM programare WHERE id_medic = ? AND (status = 'anulata' OR status = 'neprezentat')`, [id_medic])).nr;
    // 4. Durata medie consultație
    const stat = await db.get('SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? ORDER BY data DESC LIMIT 1', [id_medic]);
    const durataMedie = stat && stat.durata_medie_consultatie ? Number(stat.durata_medie_consultatie) : 0;
    // 5. Venit total
    const venitTotal = (await db.get('SELECT SUM(cost) as suma FROM consultatie WHERE id_medic = ?', [id_medic])).suma || 0;
    // 6. Rating mediu actual
    const rating = (await db.get('SELECT AVG(scor) as rating FROM feedback WHERE id_medic = ?', [id_medic])).rating || null;
    // 7. Top 3 diagnostice
    const topDiagnostice = await db.all(`SELECT diagnostic, COUNT(*) as nr FROM consultatie WHERE id_medic = ? AND diagnostic IS NOT NULL AND diagnostic != '' GROUP BY diagnostic ORDER BY nr DESC LIMIT 3`, [id_medic]);
    // 8. Evoluție săptămânală consultații (ultimele 12 săptămâni)
    const evolutie = await db.all(`
      SELECT strftime('%Y-%W', data) as saptamana, COUNT(*) as nr
      FROM consultatie
      WHERE id_medic = ? AND data >= date('now', '-84 days')
      GROUP BY saptamana
      ORDER BY saptamana ASC
    `, [id_medic]);
    // 9. Procent onorate vs. anulate/neprezentate
    const totalProgramari = (await db.get('SELECT COUNT(*) as nr FROM programare WHERE id_medic = ?', [id_medic])).nr;
    const onorate = (await db.get(`SELECT COUNT(*) as nr FROM programare WHERE id_medic = ? AND status NOT IN ('anulata','neprezentat')`, [id_medic])).nr;
    const procentOnorate = totalProgramari > 0 ? (onorate / totalProgramari * 100).toFixed(2) : null;
    const procentAnulate = totalProgramari > 0 ? (anulate / totalProgramari * 100).toFixed(2) : null;
    const rezultat = {
      totalConsultatii,
      pacientiUnici,
      anulate,
      durataMedie: Number(durataMedie),
      venitTotal: Number(venitTotal),
      rating: rating !== null ? Number(rating).toFixed(2) : null,
      topDiagnostice,
      evolutie,
      procentOnorate,
      procentAnulate
    };
    console.log(`[STAT MEDIC] Rezultat final pentru medic ${id_medic}:`, rezultat);
    res.json(rezultat);
  } catch (err) {
    res.status(500).json({ error: 'Eroare la calculul statisticilor', details: err.message });
  }
});

// --- COADA DE ASTEPTARE PER MEDIC ---
// Folosim router și db deja declarate mai sus

// GET /medici/:id/coada - returneaza coada sortata pentru un medic
router.get('/:id/coada', async (req, res) => {
    const id_medic = req.params.id;
    const azi = new Date().toISOString().split('T')[0];
    try {
        // DOAR pacienții prezenți, ordonați după ora sosirii, care au confirmat sosirea (ora_sosire validă)
        const coada = await getDb().all(`
            SELECT ca.*, p.nume, p.prenume
            FROM coada_asteptare ca
            JOIN pacient p ON ca.id_pacient = p.id_pacient
            WHERE ca.id_medic = ? AND ca.data = ?
              AND ca.status IN ('in_asteptare', 'asteptat', 'in_consultatie')
              AND ca.ora_sosire IS NOT NULL AND ca.ora_sosire != '' AND ca.ora_sosire != 'nu_a_ajuns'
            ORDER BY ca.ora_sosire ASC
        `, [id_medic, azi]);
        console.log('[DEBUG COADA MEDIC] Lista pacienți returnată:', coada);
        res.json(coada);
    } catch (err) {
        res.status(500).json({ error: 'Eroare la obtinerea cozii.' });
    }
});

// POST /medici/:id/coada/ajuns - marcheaza sosirea unui pacient in coada
router.post('/:id/coada/ajuns', async (req, res) => {
    const id_medic = req.params.id;
    const { id_pacient, data } = req.body;
    const ora_sosire = new Date().toLocaleTimeString('ro-RO', { hour12: false });
    try {
        // Update ora_sosire pentru pacientul respectiv in coada
        await getDb().run(`
            UPDATE coada_asteptare
            SET ora_sosire = ?, status = 'in_asteptare'
            WHERE id_medic = ? AND id_pacient = ? AND data = ?
        `, [ora_sosire, id_medic, id_pacient, data]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Eroare la actualizarea sosirii.' });
    }
});

// --- TOP INTERVALE ORARE AGLOMERATE ---
router.get('/statistici/intervale-orare/:id_medic', async (req, res) => {
  const db = getDb();
  const id_medic = req.params.id_medic;
  try {
    // Grupăm consultațiile pe ore (ex: 09, 10, 11 etc.)
    const intervale = await db.all(`
      SELECT substr(ora_start, 1, 2) as ora, COUNT(*) as nr
      FROM consultatie
      WHERE id_medic = ? AND data >= date('now', '-30 days')
      GROUP BY ora
      ORDER BY nr DESC, ora ASC
      LIMIT 5
    `, [id_medic]);
    // Transformăm în format "09:00 - 09:59"
    const intervaleFormatate = intervale.map(row => ({
      interval: `${row.ora}:00 - ${row.ora}:59`,
      nr: row.nr
    }));
    res.json(intervaleFormatate);
  } catch (err) {
    res.status(500).json({ error: 'Eroare la calculul intervalelor orare', details: err.message });
  }
});

// --- EVOLUȚIE ZILNICĂ CONSULTAȚII ---
router.get('/statistici/evolutie-zilnica/:id_medic', async (req, res) => {
  const db = getDb();
  const id_medic = req.params.id_medic;
  try {
    const evolutie = await db.all(`
      SELECT data, COUNT(*) as nr
      FROM consultatie
      WHERE id_medic = ? AND data >= date('now', '-30 days')
      GROUP BY data
      ORDER BY data ASC
    `, [id_medic]);
    res.json(evolutie);
  } catch (err) {
    res.status(500).json({ error: 'Eroare la calculul evoluției zilnice', details: err.message });
  }
});
router.get('/statistici/clinica', async (req, res) => {
  const db = getDb();
  try {
    console.log('[STAT CLINICA] Ruta /statistici/clinica a fost apelată!');
    // 1. Număr total consultații efectuate
    const totalConsultatii = (await db.get(`SELECT COUNT(*) AS nr FROM consultatie`)).nr;

    // 2. Număr pacienți unici care au avut cel puțin o consultație
    const pacientiUnici = (await db.get(`SELECT COUNT(DISTINCT id_pacient) AS nr FROM consultatie`)).nr;

    // 3. Durata medie a unei consultații (doar cele care au valoare)
    const durataMedie = (await db.get(`
      SELECT AVG(durata) AS durata FROM consultatie WHERE durata IS NOT NULL
    `)).durata || 0;

    // 4. Număr programări anulate sau neprezentate
    const anulate = (await db.get(`
      SELECT COUNT(*) AS nr FROM programare
      WHERE status IN ('anulata', 'neprezentat')
    `)).nr;

    // 5. Procent programări onorate vs anulate/neprezentate
    const totalProgramari = (await db.get(`SELECT COUNT(*) AS nr FROM programare`)).nr;
    const onorate = (await db.get(`
      SELECT COUNT(*) AS nr FROM programare
      WHERE status NOT IN ('anulata', 'neprezentat')
    `)).nr;

    const procentOnorate = totalProgramari > 0
      ? (onorate / totalProgramari * 100).toFixed(2)
      : null;
    const procentAnulate = totalProgramari > 0
      ? (anulate / totalProgramari * 100).toFixed(2)
      : null;

    // 6. Număr consultații care au durat peste o oră
    const consultatiiPeste1h = (await db.get(`
      SELECT COUNT(*) AS nr FROM consultatie WHERE durata >= 60
    `)).nr;

    // 7. Top 3 diagnostice cele mai frecvente
    const topDiagnostice = await db.all(`
      SELECT diagnostic, COUNT(*) AS nr FROM consultatie
      WHERE diagnostic IS NOT NULL AND diagnostic != ''
      GROUP BY diagnostic ORDER BY nr DESC LIMIT 3
    `);

    // 8. Cost mediu al unei consultații
    const costMediu = (await db.get(`
      SELECT AVG(cost) AS medie FROM consultatie WHERE cost IS NOT NULL
    `)).medie || 0;

    // 9. Rating mediu per medic + rating mediu general
    const ratingGeneral = (await db.get(`
      SELECT AVG(rating) AS medie FROM medic WHERE rating > 0
    `)).medie || 0;

    const rezultat = {
      totalConsultatii,
      pacientiUnici,
      durataMedie: Number(durataMedie.toFixed(2)),
      costMediu: Number(costMediu.toFixed(2)),
      anulate,
      totalProgramari,
      procentOnorate,
      procentAnulate,
      consultatiiPeste1h,
      topDiagnostice,
      ratingGeneral: Number(ratingGeneral.toFixed(2))
    };

    console.log('[STAT CLINICA] Rezultat final:', rezultat);
    res.json(rezultat);
  } catch (err) {
    console.error('[STAT CLINICA] EROARE:', err);
    res.status(500).json({ error: 'Eroare la calculul statisticilor pe clinică', details: err.message });
  }
});


module.exports = router; 