const express = require('express');
const cors = require('cors');
const path = require('path');
const { startDatabase, getDb } = require('./db');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const coadaRouter = require('./routes/coada');
const coadaController = require('./controllers/coadaController');

const app = express();
let db;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Atașează instanța Socket.IO la app pentru acces din rute
app.set('io', io);

app.use(cors());
app.use(express.json());
// Middleware static pentru fișierele statice (CSS, JS, imagini)
app.use('/css', express.static(path.join(__dirname, '..', 'front', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'front', 'js')));
app.use('/images', express.static(path.join(__dirname, '..', 'front', 'images')));

// Middleware pentru a preveni accesul direct la fișierele HTML
app.use('/html', (req, res, next) => {
  // Permite accesul doar la fișierele HTML specifice
  const allowedFiles = ['login.html', 'home.html', 'medic.html', 'pacient.html', 'scanare_cod.html'];
  const requestedFile = req.path.split('/').pop();
  
  if (allowedFiles.includes(requestedFile)) {
    next();
  } else {
    res.status(404).send('Pagina nu a fost găsită');
  }
});

app.use('/html', express.static(path.join(__dirname, '..', 'front', 'html')));

// Import rute separate
app.use('/api/auth', require('./routes/auth'));
app.use('/api/medici', require('./routes/medici'));
app.use('/api/pacienti', require('./routes/pacienti'));
app.use('/api/programari', require('./routes/programari'));
app.use('/api/coada', coadaRouter);

// Endpoint pentru a obține feedback-ul existent al unui pacient
app.get('/api/feedback', async (req, res) => {
  try {
    const { id_pacient } = req.query;
    if (!id_pacient) {
      return res.status(400).json({ message: 'ID-ul pacientului este obligatoriu' });
    }
    
    const feedback = await db.all(`
      SELECT id_medic, scor, comentariu, data
      FROM feedback 
      WHERE id_pacient = ?
    `, [id_pacient]);
    
    const consultatii_feedback = feedback.map(f => f.id_medic);
    
    res.json({ 
      feedback,
      consultatii_feedback 
    });
  } catch (err) {
    console.error('Eroare la obținerea feedback-ului:', err);
    res.status(500).json({ message: 'Eroare la obținerea feedback-ului' });
  }
});

// Endpoint pentru feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { id_pacient, id_medic, scor, comentariu, tip } = req.body;
    if (!id_pacient || !scor || !tip) {
      return res.status(400).json({ message: 'Lipsesc datele necesare' });
    }
    const data = new Date().toISOString().split('T')[0];
    if (tip === 'medic') {
      if (!id_medic) {
        return res.status(400).json({ message: 'ID-ul medicului este obligatoriu pentru feedback medic' });
      }
      // Verificare pe id_medic (NU pe id_consultatie)
      const feedbackExistent = await db.get(
        'SELECT 1 FROM feedback WHERE id_pacient = ? AND id_medic = ?',
        [id_pacient, id_medic]
      );
      if (feedbackExistent) {
        return res.status(409).json({ message: 'Ai oferit deja feedback acestui medic.' });
      }
      await db.run(
        'INSERT INTO feedback (id_pacient, id_medic, scor, comentariu, data) VALUES (?, ?, ?, ?, ?)',
        [id_pacient, id_medic, scor, comentariu, data]
      );
      // Actualizează rating-ul medicului
      const avgRating = await db.get(
        'SELECT AVG(scor) as rating FROM feedback WHERE id_medic = ?',
        [id_medic]
      );
      if (avgRating && avgRating.rating) {
        await db.run(
          'UPDATE medic SET rating = ? WHERE id_medic = ?',
          [avgRating.rating, id_medic]
        );
      }
    }
    res.status(201).json({ message: 'Feedback trimis cu succes!' });
  } catch (err) {
    console.error('Eroare la salvarea feedback-ului:', err);
    res.status(500).json({ message: 'Eroare la salvarea feedback-ului' });
  }
});

// Endpoint pentru a obține consultațiile finalizate ale unui pacient
app.get('/api/consultatii-finalizate/:id_pacient', async (req, res) => {
  try {
    const { id_pacient } = req.params;
    console.log('GET /api/consultatii-finalizate - Pacient ID:', id_pacient);
    
    const consultatii = await db.all(`
      SELECT 
        c.id_consultatie,
        c.data,
        c.ora_start,
        c.ora_sfarsit,
        c.diagnostic,
        c.tratament,
        c.cost,
        c.durata,
        m.nume as nume_medic,
        m.specializare,
        m.id_medic
      FROM consultatie c
      JOIN medic m ON c.id_medic = m.id_medic
      WHERE c.id_pacient = ?
      ORDER BY c.data DESC, c.ora_start DESC
    `, [id_pacient]);
    
    console.log('GET /api/consultatii-finalizate - Consultații găsite:', consultatii.length);
    if (consultatii.length > 0) {
      console.log('GET /api/consultatii-finalizate - Prima consultație:', consultatii[0]);
    }
    
    res.json(consultatii);
  } catch (err) {
    console.error('Eroare la obținerea consultațiilor:', err);
    res.status(500).json({ message: 'Eroare la obținerea consultațiilor' });
  }
});

// Endpoint pentru salvarea unei consultații
app.post('/api/consultatii', async (req, res) => {
  try {
    const { id_medic, id_pacient, data, ora_start, ora_sfarsit, diagnostic, tratament, cost } = req.body;
    
    if (!id_medic || !id_pacient || !data || !ora_start || !ora_sfarsit || !diagnostic || !tratament || cost === undefined) {
      return res.status(400).json({ message: 'Lipsesc datele necesare pentru consultație' });
    }
    
    // Calculează durata consultației în minute
    const startTime = new Date(`2000-01-01T${ora_start}`);
    const endTime = new Date(`2000-01-01T${ora_sfarsit}`);
    const durata = Math.round((endTime - startTime) / (1000 * 60));
    
    // Salvează consultația
    const result = await db.run(`
      INSERT INTO consultatie (id_medic, id_pacient, data, ora_start, ora_sfarsit, diagnostic, tratament, cost, durata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id_medic, id_pacient, data, ora_start, ora_sfarsit, diagnostic, tratament, cost, durata]);

    // Inserează automat o fișă medicală nouă la fiecare consultație
    await db.run(`
      INSERT INTO fisa_medicala (id_pacient, id_medic, diagnostic, tratament, observatii, data_actualizare)
      VALUES (?, ?, ?, ?, '', ?)
    `, [id_pacient, id_medic, diagnostic, tratament, data]);
    
    // Marchează pacientul ca finalizat în coadă
    await db.run(`
      UPDATE coada_asteptare 
      SET status = 'finalizat' 
      WHERE id_medic = ? AND id_pacient = ? AND data = ?
    `, [id_medic, id_pacient, data]);
    
    // Marchează programarea ca finalizată dacă există
    await db.run(`
      UPDATE programare 
      SET status = 'finalizat' 
      WHERE id_medic = ? AND id_pacient = ? AND data = ? AND status IN ('programata', 'intarziat')
    `, [id_medic, id_pacient, data]);

    // Anulare automată a programărilor întârziate rămase neprezentate
    try {
      const intarziati = await db.all(`
        SELECT id_programare, id_pacient FROM programare
        WHERE id_medic = ? AND data = ? AND status = 'intarziat'
      `, [id_medic, data]);
      for (const prog of intarziati) {
        await db.run(`UPDATE programare SET status = 'anulata', motiv_anulare = 'neprezentare la timp' WHERE id_programare = ?`, [prog.id_programare]);
        console.log(`[AUTO] Programarea ${prog.id_programare} (pacient ${prog.id_pacient}) a fost anulată automat după finalizarea consultației walk-in (neprezentare la timp)`);
      }
    } catch (err) {
      console.error('[AUTO] Eroare la anularea automată a programărilor întârziate:', err);
    }
    
    // Emitere eveniment Socket.IO pentru actualizare în timp real
    const io = req.app.get('io');
    if (io) {
      io.to('medic_' + id_medic).emit('queue-updated', { id_medic });
      io.to('pacient_' + id_pacient).emit('status-updated', { id_pacient, id_medic });
    }
    
    console.log('Consultație salvată cu succes:', {
      id_consultatie: result.lastID,
      id_medic,
      id_pacient,
      data,
      durata
    });
    
    // --- NOU: Update/insert persistent in tabela statistica ---
    try {
      // 1. Verifică dacă există deja rând pentru medic și zi
      const stat = await db.get(`SELECT * FROM statistica WHERE id_medic = ? AND data = ?`, [id_medic, data]);
      // 2. Calculează valorile actualizate
      // Total pacienți consultați azi
      const nr_pacienti = (await db.get(`SELECT COUNT(DISTINCT id_pacient) as nr FROM consultatie WHERE id_medic = ? AND data = ?`, [id_medic, data])).nr;
      // Durata medie consultație
      const durata_medie_consultatie = (await db.get(`SELECT AVG(durata) as durata FROM consultatie WHERE id_medic = ? AND data = ?`, [id_medic, data])).durata || 0;
      // Timp mediu așteptare (placeholder: 0, dacă nu ai logică separată)
      const timp_mediu_asteptare = 0;
      // Număr pacienți anulați
      const nr_pacienti_anulati = (await db.get(`SELECT COUNT(*) as nr FROM programare WHERE id_medic = ? AND data = ? AND status = 'anulata'`, [id_medic, data])).nr;
      // Consultații peste 1h
      const consultatii_peste_1h = (await db.get(`SELECT COUNT(*) as nr FROM consultatie WHERE id_medic = ? AND data = ? AND durata >= 60`, [id_medic, data])).nr;
      // Cost mediu consultație
      const cost_mediu_consultatie = (await db.get(`SELECT AVG(cost) as cost FROM consultatie WHERE id_medic = ? AND data = ?`, [id_medic, data])).cost || 0;
      console.log('[STATISTICA] Update/insert pentru medic', id_medic, 'data', data, {
        nr_pacienti, durata_medie_consultatie, timp_mediu_asteptare, nr_pacienti_anulati, consultatii_peste_1h, cost_mediu_consultatie
      });
      if (!stat) {
        // Insert nou
        await db.run(`INSERT INTO statistica (id_medic, data, nr_pacienti, durata_medie_consultatie, timp_mediu_asteptare, nr_pacienti_anulati, consultatii_peste_1h, cost_mediu_consultatie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_medic, data, nr_pacienti, durata_medie_consultatie, timp_mediu_asteptare, nr_pacienti_anulati, consultatii_peste_1h, cost_mediu_consultatie]);
        console.log('[STATISTICA] INSERT efectuat!');
      } else {
        // Update
        await db.run(`UPDATE statistica SET nr_pacienti = ?, durata_medie_consultatie = ?, timp_mediu_asteptare = ?, nr_pacienti_anulati = ?, consultatii_peste_1h = ?, cost_mediu_consultatie = ? WHERE id_medic = ? AND data = ?`,
          [nr_pacienti, durata_medie_consultatie, timp_mediu_asteptare, nr_pacienti_anulati, consultatii_peste_1h, cost_mediu_consultatie, id_medic, data]);
        console.log('[STATISTICA] UPDATE efectuat!');
      }
    } catch (err) {
      console.error('[STATISTICA] Eroare la update/insert statistica:', err);
    }
    
    res.status(201).json({ 
      message: 'Consultația a fost salvată cu succes!',
      id_consultatie: result.lastID
    });
  } catch (err) {
    console.error('Eroare la salvarea consultației:', err);
    res.status(500).json({ message: 'Eroare la salvarea consultației', error: err.message });
  }
});

// Route-uri pentru paginile HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'home.html'));
});

app.get('/home.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'home.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'login.html'));
});

app.get('/medic.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'medic.html'));
});

app.get('/pacient.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'pacient.html'));
});

app.get('/scanare_cod.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'front', 'html', 'scanare_cod.html'));
});

// Fișa medicală a pacientului
app.get("/api/fisa/:id_pacient", async (req, res) => {
  try {
    const fisa = await getDb().get(
      `SELECT * FROM fisa_medicala WHERE id_pacient = ?`,
      [req.params.id_pacient]
    );
    if (!fisa) return res.status(404).json({ error: "Fișă medicală inexistentă" });
    res.json(fisa);
  } catch (err) {
    res.status(500).json({ error: "Eroare server" });
  }
});

// Fișa medicală completă cu istoric consultații
app.get("/api/fisa-medicala/:id_pacient", async (req, res) => {
  try {
    const { id_pacient } = req.params;
    const { id_medic } = req.query;
    
    // Datele pacientului
    const pacient = await getDb().get(`
      SELECT 
        id_pacient,
        nume || ' ' || prenume as nume_complet,
        data_nasterii,
        (CAST((julianday('now') - julianday(data_nasterii)) / 365.25 AS INTEGER)) as varsta,
        email,
        telefon
      FROM pacient 
      WHERE id_pacient = ?
    `, [id_pacient]);
    
    if (!pacient) {
      return res.status(404).json({ error: "Pacient inexistent" });
    }
    
    // Istoricul consultațiilor (doar cu medicul curent dacă este specificat)
    let consultatiiQuery = `
      SELECT 
        c.id_consultatie,
        c.data,
        c.ora_start,
        c.ora_sfarsit,
        c.diagnostic,
        c.tratament,
        c.cost,
        c.durata,
        m.nume as nume_medic,
        m.specializare
      FROM consultatie c
      JOIN medic m ON c.id_medic = m.id_medic
      WHERE c.id_pacient = ?
    `;
    
    const consultatiiParams = [id_pacient];
    
    if (id_medic) {
      consultatiiQuery += ' AND c.id_medic = ?';
      consultatiiParams.push(id_medic);
    }
    
    consultatiiQuery += ' ORDER BY c.data DESC, c.ora_start DESC';
    
    const istoric_consultatii = await getDb().all(consultatiiQuery, consultatiiParams);
    
    res.json({
      pacient,
      istoric_consultatii
    });
  } catch (err) {
    console.error('Eroare la obținerea fișei medicale:', err);
    res.status(500).json({ error: "Eroare server" });
  }
});

// Date pacient
app.get("/api/pacient/:id", async (req, res) => {
  try {
    const pacient = await getDb().get(
      `SELECT * FROM pacient WHERE id_pacient = ?`,
      [req.params.id]
    );
    if (!pacient) return res.status(404).json({ error: "Pacient inexistent" });
    res.json(pacient);
  } catch (err) {
    console.error("Eroare la preluarea pacientului:", err.message);
    res.status(500).json({ error: "Eroare server" });
  }
});

// Specializări distincte din baza de date
app.get('/api/specializari', async (req, res) => {
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

// Date despre un singur medic (GET /api/medic/:id)
app.get('/api/medic/:id', async (req, res) => {
  try {
    const medic = await db.get('SELECT * FROM medic WHERE id_medic = ?', [req.params.id]);
    if (!medic) return res.status(404).json({ error: 'Medic inexistent' });
    res.json(medic);
  } catch (err) {
    res.status(500).json({ error: 'Eroare server' });
  }
});

// Programări pentru un medic într-o anumită zi (GET /api/programari/medic/:id_medic/:data)
app.get('/api/programari/medic/:id_medic/:data', async (req, res) => {
  try {
    const { id_medic, data } = req.params;
    const programari = await db.all(`
      SELECT p.id_programare, p.id_pacient, p.ora, p.status,
             pa.nume || ' ' || pa.prenume as nume_pacient
      FROM programare p
      JOIN pacient pa ON p.id_pacient = pa.id_pacient
      WHERE p.id_medic = ? AND p.data = ?
      ORDER BY p.ora ASC
    `, [id_medic, data]);
    res.json(programari);
  } catch (err) {
    console.error('Eroare la încărcarea programărilor medicului:', err);
    res.status(500).json({ message: 'Eroare la încărcarea programărilor', error: err.message });
  }
});

// --- MODIFICARE /api/coada_pacienti/:id_medic/:data ---
app.get('/api/coada_pacienti/:id_medic/:data', async (req, res) => {
  try {
    const { id_medic, data } = req.params;
    const now = new Date();
    // 1. Actualizare status programări întârziate/anulate
    try {
      const programari = await db.all(`
        SELECT * FROM programare
        WHERE id_medic = ? AND data = ? AND (status = 'programata' OR status = 'intarziat')
      `, [id_medic, data]);
      for (const prog of programari) {
        const [h, m] = prog.ora.split(':');
        const progDate = new Date(`${data}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`);
        const diffMin = (now - progDate) / 60000;
        
        console.log(`[AUTO] Verific programare ${prog.id_programare}: status=${prog.status}, ora=${prog.ora}, diffMin=${diffMin.toFixed(1)}`);
        
        if (prog.status === 'programata' && diffMin > 15) {
          await db.run(`UPDATE programare SET status = 'anulata', motiv_anulare = 'neprezentare la timp' WHERE id_programare = ?`, [prog.id_programare]);
          console.log(`[AUTO] Programare ${prog.id_programare} anulata automat (neprezentare la timp - ${diffMin.toFixed(1)} min intarziere)`);
        } else if (prog.status === 'programata' && diffMin > 5) {
          await db.run(`UPDATE programare SET status = 'intarziat' WHERE id_programare = ?`, [prog.id_programare]);
          console.log(`[AUTO] Programare ${prog.id_programare} marcata ca intarziata (${diffMin.toFixed(1)} min intarziere)`);
        } else if (prog.status === 'intarziat' && diffMin > 15) {
          await db.run(`UPDATE programare SET status = 'anulata', motiv_anulare = 'neprezentare la timp' WHERE id_programare = ?`, [prog.id_programare]);
          console.log(`[AUTO] Programare ${prog.id_programare} intarziata a fost anulata automat (${diffMin.toFixed(1)} min intarziere)`);
        }
      }
    } catch (err) {
      console.error('[AUTO] Eroare la actualizarea statusului programarilor:', err);
    }
    // 2. Toți din coadă cu status activ, ordonați după ora sosirii
    const coada = await db.all(`
      SELECT ca.id_pacient, ca.ora_sosire, 'coada' as tip, NULL as ora_programare, NULL as status_programare,
             ca.status as status_coada,
             p.nume || ' ' || p.prenume as nume_pacient
      FROM coada_asteptare ca
      JOIN pacient p ON ca.id_pacient = p.id_pacient
      WHERE ca.id_medic = ? AND ca.data = ? AND ca.status IN ('in_asteptare', 'asteptat', 'in_consultatie')
      ORDER BY ca.ora_sosire ASC
    `, [id_medic, data]);
    // 2b. Pacienți deja consultați (finalizat)
    const finalizati = await db.all(`
      SELECT id_pacient FROM coada_asteptare WHERE id_medic = ? AND data = ? AND status = 'finalizat'`, [id_medic, data]);
    const finalizatiIds = finalizati.map(f => f.id_pacient);
    // 3. Medie consultație
    const medie = await db.get(`SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata > 0 AND data >= date('now', '-30 days')`, [id_medic]);
    let durata_medie = medie && medie.durata_medie ? Math.round(medie.durata_medie) : 30;
    if (durata_medie <= 0 || isNaN(durata_medie)) durata_medie = 30;
    // 4. Ordonează coada conform logicii cerute
    // --- NOU: Include explicit programările neajunse în lista finală ---
    const coadaIds = coada.map(c => c.id_pacient);
    const programariNeajunse = coada.filter(p => !coadaIds.includes(p.id_pacient) && !finalizatiIds.includes(p.id_pacient) && p.status_coada === 'nu_a_ajuns').map(p => ({
      id_pacient: p.id_pacient,
      ora_sosire: p.ora_sosire,
      status_coada: 'nu_a_ajuns',
      nume_pacient: p.nume_pacient,
      tip: 'coada',
      ora_programare: null,
      status_programare: null
    }));
    // Lista finală: programări neajunse (în ordinea programării), apoi prezenți fizic (în ordinea sosirii)
    const listaFinala = [...programariNeajunse, ...coada];
    console.log('[DEBUG COADA_PACIENTI] Lista finală coadă:', listaFinala);
    res.json(listaFinala);
  } catch (err) {
    res.status(500).json({ message: 'Eroare la încărcarea listei pacienților din coadă', error: err.message });
  }
});

// Coada efectivă pentru medic (doar pacienți prezenți fizic)
app.get('/api/coada_efectiva/:id_medic/:data', async (req, res) => {
  const db = getDb();
  const { id_medic, data } = req.params;
  try {
    // 1. Pacienți prezenți efectiv în coadă
    const coada = await db.all(`
      SELECT ca.id_pacient, ca.ora_sosire, ca.status as status_coada,
             p.nume || ' ' || p.prenume as nume_pacient
      FROM coada_asteptare ca
      JOIN pacient p ON ca.id_pacient = p.id_pacient
      WHERE ca.id_medic = ? AND ca.data = ?
        AND ca.status IN ('in_asteptare', 'asteptat', 'in_consultatie')
        AND ca.ora_sosire IS NOT NULL AND ca.ora_sosire != '' AND ca.ora_sosire != 'nu_a_ajuns'
      ORDER BY ca.ora_sosire ASC
    `, [id_medic, data]);
    // 2. Programări viitoare (doar cu nume, ora, status, fără a fi în coadă)
    const programari = await db.all(`
      SELECT p.id_pacient, p.ora, p.status,
             pac.nume || ' ' || pac.prenume as nume_pacient
      FROM programare p
      JOIN pacient pac ON p.id_pacient = pac.id_pacient
      WHERE p.id_medic = ? AND p.data = ? AND p.status = 'programata'
      ORDER BY p.ora ASC
    `, [id_medic, data]);
    // 3. Durata medie
    let durata_medie = null;
    const stat = await db.get('SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? AND data = ?', [id_medic, data]);
    if (stat && stat.durata_medie_consultatie) {
      durata_medie = Math.round(stat.durata_medie_consultatie);
    } else {
      const resultMedie = await db.get('SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata > 0 AND data >= date(\'now\', \'-30 days\')', [id_medic]);
      durata_medie = resultMedie && resultMedie.durata_medie ? Math.round(resultMedie.durata_medie) : 30;
    }
    if (durata_medie <= 0 || isNaN(durata_medie)) durata_medie = 30;
    res.json({ coada, programari, durata_medie_consultatie: durata_medie });
  } catch (err) {
    res.status(500).json({ error: 'Eroare la obtinerea cozii.' });
  }
});

// Simulare coadă pentru pacient (fără ID specific)
app.get('/api/coada_simulare/:id_medic/:data', async (req, res) => {
  try {
    const { id_medic, data } = req.params;
    // 1. Calculează durata medie reală a consultațiilor (ultimele 30 zile)
    const medieRow = await db.get(`
      SELECT AVG(durata) as durata_medie
      FROM consultatie
      WHERE id_medic = ? AND durata > 0 AND data >= date('now', '-30 days')
    `, [id_medic]);
    let durata_medie = medieRow && medieRow.durata_medie ? Math.round(medieRow.durata_medie) : 30;
    if (durata_medie <= 0 || isNaN(durata_medie)) durata_medie = 30;
    
    // 2. Toate programările neanulate, ordonate după oră
    let programari = await db.all(`
      SELECT p.id_pacient, p.ora, p.status
      FROM programare p
      WHERE p.id_medic = ? AND p.data = ? AND p.status != 'anulata'
      ORDER BY p.ora ASC
    `, [id_medic, data]);
    
    // 3. Pacienți deja în coadă (prezenți fizic)
    const coada = await db.all(`
      SELECT id_pacient, ora_sosire, status
      FROM coada_asteptare
      WHERE id_medic = ? AND data = ? AND status IN ('in_asteptare', 'asteptat')
      ORDER BY ora_sosire ASC
    `, [id_medic, data]);
    
    // 4. Anulează automat programările întârziate cu peste 5 minute care nu au confirmat sosirea
    const now = new Date();
    for (const prog of programari) {
      if (prog.status === 'programata') {
        const [h, m] = prog.ora.split(':').map(Number);
        const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        const diffMin = (now - progDate) / (1000 * 60);
        // Verifică dacă există confirmare de sosire în coadă
        const confirmare = coada.find(c => c.id_pacient === prog.id_pacient);
        if (diffMin > 5 && !confirmare) {
          await db.run('UPDATE programare SET status = "anulata" WHERE id_medic = ? AND id_pacient = ? AND data = ? AND ora = ?', [id_medic, prog.id_pacient, data, prog.ora]);
        }
      }
    }
    
    // Reîncarcă programările după anulare
    programari = await db.all(`
      SELECT p.id_pacient, p.ora, p.status
      FROM programare p
      WHERE p.id_medic = ? AND p.data = ? AND p.status != 'anulata'
      ORDER BY p.ora ASC
    `, [id_medic, data]);

    // 5. Simulează poziția pacientului fără programare (walk-in)
    let pozitie = 1;
    let persoane_in_fata = 0;
    let timp_estimare = 0;
    let poate_intra_inainte = true;
    let nextProgOra = null;
    let programareBlocanta = null;
    
    // Calculează momentul estimat de intrare al walk-in-ului
    const momentIntrareWalkin = new Date(now.getTime() + (coada.length * durata_medie * 60 * 1000));
    
    // Numără programările viitoare care vor fi în fața walk-in-ului
    let programariInFata = 0;
    for (const prog of programari) {
      if (prog.status === 'anulata' || prog.status === 'finalizat') continue;
      
      const [h, m] = prog.ora.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      // Dacă programarea este în viitor (nu a trecut încă)
      if (progDate > now) {
        programariInFata++;
      }
    }
    
    // Găsește următoarea programare validă (nu anulată, nu întârziată peste 15 min)
    for (let i = 0; i < programari.length; i++) {
      const prog = programari[i];
      if (prog.status === 'anulata') continue;
      
      const [h, m] = prog.ora.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const diffMin = (progDate - now) / (1000 * 60);
      
      // Dacă programarea este întârziată peste 15 minute, sări peste ea
      if (diffMin < -15) continue;
      
      // Calculează timpul estimat până la această programare
      const timpPanaLaProgramare = Math.max(0, diffMin);
      const timpEstimarePanaLaProgramare = (coada.length * durata_medie) + timpPanaLaProgramare;
      
      // Dacă timpul estimat până la programare depășește ora programării, 
      // walk-in-ul va fi blocat de această programare
      if (timpEstimarePanaLaProgramare > timpPanaLaProgramare) {
        nextProgOra = prog.ora;
        programareBlocanta = prog;
        poate_intra_inainte = false;
        break;
      }
    }
    
    if (!poate_intra_inainte && nextProgOra) {
      // Va fi plasat după programare (dacă aceasta nu este întârziată peste 5 minute)
      const [h, m] = nextProgOra.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const diffMin = (progDate - now) / (1000 * 60);
      
      if (diffMin < -5) {
        // Programarea este întârziată peste 5 minute, walk-in-ul poate intra înainte
        persoane_in_fata = coada.length + programariInFata;
        timp_estimare = (coada.length + programariInFata) * durata_medie;
        poate_intra_inainte = true;
        nextProgOra = null;
      } else {
        // Programarea este în timp, walk-in-ul va fi plasat după ea
        persoane_in_fata = coada.length + programariInFata + 1;
        timp_estimare = (coada.length + programariInFata + 1) * durata_medie;
      }
    } else {
      // Poate intra înainte
      persoane_in_fata = coada.length + programariInFata;
      timp_estimare = (coada.length + programariInFata) * durata_medie;
    }
    
    // Fallback explicit pentru coada goală
    if (coada.length === 0 && programariInFata === 0) {
      persoane_in_fata = 0;
      timp_estimare = 0;
    }
    
    res.json({
      pozitie,
      persoane_in_fata,
      timp_estimare,
      durata_medie,
      nextProgOra,
      poate_intra_inainte,
      programare: false
    });
  } catch (err) {
    res.status(500).json({ message: 'Eroare la simularea cozii', error: err.message });
  }
});

// Simulare coadă pentru pacient cu ID specific (pentru compatibilitate)
app.get('/api/coada_simulare/:id_medic/:data/:id_pacient', async (req, res) => {
  try {
    const { id_medic, data, id_pacient } = req.params;
    // 1. Calculează durata medie reală a consultațiilor (ultimele 30 zile)
    const stat = await db.get('SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? AND data = ?', [id_medic, data]);
    let durata_medie = stat && stat.durata_medie_consultatie ? Math.round(stat.durata_medie_consultatie) : null;
    if (!durata_medie) {
      const medieRow = await db.get('SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata > 0 AND data >= date(\'now\', \'-30 days\')', [id_medic]);
      durata_medie = medieRow && medieRow.durata_medie ? Math.round(medieRow.durata_medie) : 30;
    }
    if (durata_medie <= 0 || isNaN(durata_medie)) durata_medie = 30;
    
    // 2. Toate programările neanulate, ordonate după oră
    let programari = await db.all(`
      SELECT p.id_pacient, p.ora, p.status
      FROM programare p
      WHERE p.id_medic = ? AND p.data = ? AND p.status != 'anulata'
      ORDER BY p.ora ASC
    `, [id_medic, data]);
    // 3. Pacienți deja în coadă (prezenți fizic)
    const coada = await db.all(`
      SELECT id_pacient, ora_sosire, status
      FROM coada_asteptare
      WHERE id_medic = ? AND data = ? AND status IN ('in_asteptare', 'asteptat')
      ORDER BY ora_sosire ASC
    `, [id_medic, data]);
    // --- NOU: Elimină programările pentru pacienții deja în coadă ---
    const pacientiInCoada = new Set(coada.map(c => String(c.id_pacient)));
    programari = programari.filter(p => !pacientiInCoada.has(String(p.id_pacient)));
    // 4. Anulează automat programările întârziate cu peste 5 minute care nu au confirmat sosirea
    const now = new Date();
    for (const prog of programari) {
      if (prog.status === 'programata') {
        const [h, m] = prog.ora.split(':').map(Number);
        const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        const diffMin = (now - progDate) / (1000 * 60);
        // Verifică dacă există confirmare de sosire în coadă
        const confirmare = coada.find(c => c.id_pacient === prog.id_pacient);
        if (diffMin > 5 && !confirmare) {
          await db.run('UPDATE programare SET status = "anulata" WHERE id_medic = ? AND id_pacient = ? AND data = ? AND ora = ?', [id_medic, prog.id_pacient, data, prog.ora]);
        }
      }
    }
    // Reîncarcă programările după anulare
    programari = await db.all(`
      SELECT p.id_pacient, p.ora, p.status
      FROM programare p
      WHERE p.id_medic = ? AND p.data = ? AND p.status != 'anulata'
      ORDER BY p.ora ASC
    `, [id_medic, data]);

    // --- NOU: verifică dacă pacientul are programare validă ---
    const programareaMea = programari.find(p => p.id_pacient == id_pacient && p.status === 'programata');
    if (programareaMea) {
      // Calculează poziția printre programări
      const indexProg = programari.filter(p => p.status === 'programata').findIndex(p => p.id_pacient == id_pacient);
      // Persoane în față = programări cu oră mai mică (exclusiv el însuși) + toți din coadă cu status in_asteptare/asteptat și ora_sosire < ora programării
      const [h, m] = programareaMea.ora.split(':').map(Number);
      const oraProgDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const persoane_in_fata = programari.filter(p => p.status === 'programata' && p.ora < programareaMea.ora && p.id_pacient != id_pacient).length
        + coada.filter(c => c.ora_sosire < programareaMea.ora).length;
      const timp_estimare = persoane_in_fata * durata_medie;
      return res.json({
        pozitie: indexProg + 1,
        persoane_in_fata,
        timp_estimare,
        durata_medie,
        nextProgOra: programareaMea.ora,
        programare: true
      });
    }
    // --- END NOU ---

    // 5. Simulează poziția pacientului fără programare (walk-in)
    let pozitie = 1;
    let persoane_in_fata = 0;
    let timp_estimare = 0;
    let poate_intra_inainte = true;
    let nextProgOra = null;
    let programareBlocanta = null;
    
    // Calculează momentul estimat de intrare al walk-in-ului
    const momentIntrareWalkin = new Date(now.getTime() + (coada.length * durata_medie * 60 * 1000));
    
    // Numără programările viitoare care vor fi în fața walk-in-ului
    let programariInFata = 0;
    for (const prog of programari) {
      if (prog.status === 'anulata' || prog.status === 'finalizat') continue;
      
      const [h, m] = prog.ora.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      // Dacă programarea este în viitor (nu a trecut încă)
      if (progDate > now) {
        programariInFata++;
      }
    }
    
    // Găsește următoarea programare validă (nu anulată, nu întârziată peste 15 min)
    for (let i = 0; i < programari.length; i++) {
      const prog = programari[i];
      if (prog.status === 'anulata') continue;
      
      const [h, m] = prog.ora.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const diffMin = (progDate - now) / (1000 * 60);
      
      // Dacă programarea este întârziată peste 15 minute, sări peste ea
      if (diffMin < -15) continue;
      
      // Calculează timpul estimat până la această programare
      const timpPanaLaProgramare = Math.max(0, diffMin);
      const timpEstimarePanaLaProgramare = (coada.length * durata_medie) + timpPanaLaProgramare;
      
      // Dacă timpul estimat până la programare depășește ora programării, 
      // walk-in-ul va fi blocat de această programare
      if (timpEstimarePanaLaProgramare > timpPanaLaProgramare) {
        nextProgOra = prog.ora;
        programareBlocanta = prog;
        poate_intra_inainte = false;
        break;
      }
    }
    
    if (!poate_intra_inainte && nextProgOra) {
      // Va fi plasat după programare (dacă aceasta nu este întârziată peste 5 minute)
      const [h, m] = nextProgOra.split(':').map(Number);
      const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const diffMin = (progDate - now) / (1000 * 60);
      
      if (diffMin < -5) {
        // Programarea este întârziată peste 5 minute, walk-in-ul poate intra înainte
        persoane_in_fata = coada.length + programariInFata;
        timp_estimare = (coada.length + programariInFata) * durata_medie;
        poate_intra_inainte = true;
        nextProgOra = null;
      } else {
        // Programarea este în timp, walk-in-ul va fi plasat după ea
        persoane_in_fata = coada.length + programariInFata + 1;
        timp_estimare = (coada.length + programariInFata + 1) * durata_medie;
      }
    } else {
      // Poate intra înainte
      persoane_in_fata = coada.length + programariInFata;
      timp_estimare = (coada.length + programariInFata) * durata_medie;
    }
    
    // --- NOU: Fallback explicit pentru coada goală ---
    if (coada.length === 0 && programariInFata === 0) {
      persoane_in_fata = 0;
      timp_estimare = 0;
    }
    
    // --- NOU: Loguri pentru debug ---
    console.log('Simulare coada pentru medic', id_medic, 'data', data, 'pacient', id_pacient);
    console.log('Coada actuala:', coada);
    console.log('Programari:', programari);
    console.log('Rezultat simulare:', { pozitie, persoane_in_fata, timp_estimare, durata_medie, nextProgOra, poate_intra_inainte, programare: false });
    
    res.json({
      pozitie,
      persoane_in_fata,
      timp_estimare,
      durata_medie,
      nextProgOra,
      poate_intra_inainte,
      programare: false
    });
  } catch (err) {
    res.status(500).json({ message: 'Eroare la simularea cozii', error: err.message });
  }
});

// Status personalizat pentru pacient la coada unui medic (folosit de scanare_cod.js)
app.get('/api/coada_pacient', coadaController.statusPacientCoada);
// Status pacient în coadă (compatibilitate cu frontend-ul)
app.get('/api/coada/status_pacient/:id_pacient/:id_medic/:data', coadaController.statusPacientCoada);

// --- SOCKET.IO LOGICĂ DE BAZĂ ---
io.on('connection', (socket) => {
  // Clientul trebuie să trimită id_medic pentru a se abona la camera corectă
  socket.on('join-medic-room', (id_medic) => {
    if (id_medic) {
      socket.join('medic_' + id_medic);
    }
  });
  // (opțional) poți loga conectările
  // socket.on('disconnect', () => { ... });
  // Pacientul se abonează la camera proprie
  socket.on('join-pacient-room', (id_pacient) => {
    if (id_pacient) {
      socket.join('pacient_' + id_pacient);
    }
  });
});

// --- SOCKET.IO: join-medic-room pentru actualizare programari in timp real ---
io.on('connection', (socket) => {
  socket.on('join-medic-room', (medicId) => {
    if (medicId) {
      socket.join('medic_' + medicId);
    }
  });
});

// Actualizare diagnostic consultatie
app.put('/api/consultatii/update-diagnostic/:id_consultatie', async (req, res) => {
  try {
    const { id_consultatie } = req.params;
    const { diagnostic } = req.body;
    if (!diagnostic) return res.status(400).json({ error: 'Diagnostic lipsă' });
    await getDb().run(
      'UPDATE consultatie SET diagnostic = ? WHERE id_consultatie = ?',
      [diagnostic, id_consultatie]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Eroare la actualizarea diagnosticului' });
  }
});

// Actualizare tratament consultatie
app.put('/api/consultatii/update-tratament/:id_consultatie', async (req, res) => {
  try {
    const { id_consultatie } = req.params;
    const { tratament } = req.body;
    if (!tratament) return res.status(400).json({ error: 'Tratament lipsă' });
    await getDb().run(
      'UPDATE consultatie SET tratament = ? WHERE id_consultatie = ?',
      [tratament, id_consultatie]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Eroare la actualizarea tratamentului' });
  }
});

// Pornire server
startDatabase().then(async (connected) => {
  if (!connected) {
    console.log("Serverul se oprește");
    process.exit(1);
  }
  db = getDb();

  // Populare automată medici dacă tabela este goală
  const nrMedici = await db.get('SELECT COUNT(*) as count FROM medic');
  if (nrMedici.count === 0) {
    const medici = [
      { nume: "Marin Doru", specializare: "Stomatologie generală", email: "doru@ace.clinic.ro", telefon: "0722000010", parola: "parola123" },
      { nume: "Zamfir Anca", specializare: "Stomatologie generală", email: "anca.zamfir@ace.clinic.ro", telefon: "0722000021", parola: "parola123" },
      { nume: "Voinea Bogdan", specializare: "Stomatologie generală", email: "bogdan.voinea@ace.clinic.ro", telefon: "0722000022", parola: "parola123" },
      { nume: "Radu Mihai", specializare: "Ortodonție", email: "radu@ace.clinic.ro", telefon: "0722000002", parola: "parola123" },
      { nume: "Georgescu Irina", specializare: "Ortodonție", email: "irina.georgescu@ace.clinic.ro", telefon: "0722000023", parola: "parola123" },
      { nume: "Barbu Adrian", specializare: "Ortodonție", email: "adrian.barbu@ace.clinic.ro", telefon: "0722000024", parola: "parola123" },
      { nume: "Ghiță Iulian", specializare: "Protetică dentară", email: "ghita@ace.clinic.ro", telefon: "0722000003", parola: "parola123" },
      { nume: "Mihăilescu Simona", specializare: "Protetică dentară", email: "simona.miha@ace.clinic.ro", telefon: "0722000025", parola: "parola123" },
      { nume: "Cristea Vlad", specializare: "Protetică dentară", email: "vlad.cristea@ace.clinic.ro", telefon: "0722000026", parola: "parola123" },
      { nume: "Drăgan Sorin", specializare: "Chirurgie dento-alveolară", email: "sorin@ace.clinic.ro", telefon: "0722000005", parola: "parola123" },
      { nume: "Tănase Maria", specializare: "Chirurgie dento-alveolară", email: "maria.tanase@ace.clinic.ro", telefon: "0722000027", parola: "parola123" },
      { nume: "Cojocaru Ion", specializare: "Chirurgie dento-alveolară", email: "ion.cojocaru@ace.clinic.ro", telefon: "0722000028", parola: "parola123" },
      { nume: "Ionescu Mirela", specializare: "Endodonție", email: "mirela@ace.clinic.ro", telefon: "0722000006", parola: "parola123" },
      { nume: "Petrescu Alex", specializare: "Endodonție", email: "alex.petrescu@ace.clinic.ro", telefon: "0722000029", parola: "parola123" },
      { nume: "Banu Florina", specializare: "Endodonție", email: "florina.banu@ace.clinic.ro", telefon: "0722000030", parola: "parola123" },
      { nume: "Constantinescu Vlad", specializare: "Parodontologie", email: "vlad@ace.clinic.ro", telefon: "0722000007", parola: "parola123" },
      { nume: "Savulescu Anca", specializare: "Parodontologie", email: "anca.savulescu@ace.clinic.ro", telefon: "0722000031", parola: "parola123" },
      { nume: "Ilie Dorin", specializare: "Parodontologie", email: "dorin.ilie@ace.clinic.ro", telefon: "0722000032", parola: "parola123" },
      { nume: "Enache Paula", specializare: "Radiologie dentară", email: "paula@ace.clinic.ro", telefon: "0722000008", parola: "parola123" },
      { nume: "Chivu Marius", specializare: "Radiologie dentară", email: "marius.chivu@ace.clinic.ro", telefon: "0722000033", parola: "parola123" },
      { nume: "Rosu Bianca", specializare: "Radiologie dentară", email: "bianca.rosu@ace.clinic.ro", telefon: "0722000034", parola: "parola123" },
      { nume: "Voicu Ana", specializare: "Estetică dentară", email: "ana@ace.clinic.ro", telefon: "0722000009", parola: "parola123" },
      { nume: "Marinescu Teodora", specializare: "Estetică dentară", email: "teodora.marinescu@ace.clinic.ro", telefon: "0722000035", parola: "parola123" },
      { nume: "Pavel Iulia", specializare: "Estetică dentară", email: "iulia.pavel@ace.clinic.ro", telefon: "0722000036", parola: "parola123" },
      { nume: "Popa Elena", specializare: "Primiri urgențe dentare", email: "elena@ace.clinic.ro", telefon: "0722000004", parola: "parola123" },
      { nume: "Matei Ruxandra", specializare: "Primiri urgențe dentare", email: "ruxandra.matei@ace.clinic.ro", telefon: "0722000037", parola: "parola123" },
      { nume: "Grigore Andrei", specializare: "Primiri urgențe dentare", email: "andrei.grigore@ace.clinic.ro", telefon: "0722000038", parola: "parola123" }
    ];
    for (const medic of medici) {
      const hashedPassword = await bcrypt.hash(medic.parola, 10);
      await db.run(
        `INSERT INTO medic (nume, specializare, email, telefon, parola)
         VALUES (?, ?, ?, ?, ?)`,
        [medic.nume, medic.specializare, medic.email, medic.telefon, hashedPassword]
      );
    }
    console.log("Tabelul medic a fost populat automat!");
  }

  server.listen(3000, '0.0.0.0', () => {
    console.log("Serverul rulează pe http://localhost:3000");
  });
});
