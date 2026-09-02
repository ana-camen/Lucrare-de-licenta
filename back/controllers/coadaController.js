// Controller pentru coada de așteptare per medic
const { getDb } = require('../db');

// Status coadă pentru un medic
exports.statusCoadaMedic = async (req, res) => {
  try {
    const id_medic = req.params.id;
    const azi = new Date().toISOString().split('T')[0];
    // Numără DOAR pacienții prezenți efectiv în coadă (cu ora_sosire validă)
    const resultTotal = await getDb().get(
      `SELECT COUNT(*) as nr FROM coada_asteptare WHERE id_medic = ? AND data = ? AND status IN ('in_asteptare', 'asteptat', 'in_consultatie') AND ora_sosire IS NOT NULL AND ora_sosire != '' AND ora_sosire != 'nu_a_ajuns'`,
      [id_medic, azi]
    );
    const numar_pacienti_in_fata = resultTotal ? resultTotal.nr : 0;
    const stat = await getDb().get('SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? AND data = ?', [id_medic, azi]);
    let durata_medie_consultatie = stat && stat.durata_medie_consultatie ? Math.round(stat.durata_medie_consultatie) : null;
    if (!durata_medie_consultatie) {
      const resultMedie = await getDb().get('SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata > 0 AND data >= date(\'now\', \'-30 days\')', [id_medic]);
      durata_medie_consultatie = resultMedie && resultMedie.durata_medie ? Math.round(resultMedie.durata_medie) : 30;
    }
    if (durata_medie_consultatie <= 0 || isNaN(durata_medie_consultatie)) durata_medie_consultatie = 30;
    const timp_estimare = numar_pacienti_in_fata * durata_medie_consultatie;
    res.json({
      numar_pacienti_in_fata,
      durata_medie_consultatie,
      timp_estimare
    });
  } catch (err) {
    res.status(500).json({ message: 'Eroare la status coadă', error: err.message });
  }
};

// Adaugă pacient la coadă
exports.adaugaLaCoada = async (req, res) => {
  try {
    const id_medic = req.params.id;
    const { id_pacient, data, programare } = req.body;
    if (!id_pacient || !id_medic) {
      return res.status(400).json({ message: 'Lipsesc datele necesare (id_pacient, id_medic)' });
    }
    const now = new Date();
    const dataLocala = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const azi = data || dataLocala;
    const ora = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // 1. Verifică dacă pacientul are programare activă (status 'programata')
    const programareActiva = await getDb().get('SELECT * FROM programare WHERE id_pacient = ? AND id_medic = ? AND data = ? AND status = "programata"', [id_pacient, id_medic, azi]);
    // 2. Verifică dacă pacientul este deja în coadă cu status activ
    const dejaInCoada = await getDb().get('SELECT * FROM coada_asteptare WHERE id_pacient = ? AND id_medic = ? AND data = ? AND status IN ("in_asteptare", "asteptat", "in_consultatie")', [id_pacient, id_medic, azi]);
    if (dejaInCoada) {
      return res.status(200).json({ message: 'Ești deja în coadă la acest medic pentru astăzi.' });
    }
    // 3. Dacă are programare și apasă 'Anunță că am ajuns', inserează cu status 'in_asteptare'
    if (programareActiva) {
      // Pentru pacienții cu programare, folosește ora programării ca ora_sosire pentru poziționare corectă
      const oraSosireProgramare = programareActiva.ora + ':00'; // Adaugă secunde pentru format consistent
      await getDb().run('INSERT INTO coada_asteptare (id_pacient, id_medic, data, ora_sosire, status) VALUES (?, ?, ?, ?, "in_asteptare")', [id_pacient, id_medic, azi, oraSosireProgramare]);
      const io = req.app.get('io');
      if (io) {
        io.to('medic_' + id_medic).emit('queue-updated', { id_medic });
        io.to('pacient_' + id_pacient).emit('status-updated', { id_pacient, id_medic });
      }
      return res.status(201).json({ message: 'Ai anunțat sosirea la programare și ești în coadă!' });
    }
    // 2.1. Verifică dacă pacientul are deja o programare activă la acest medic în această zi (doar pentru walk-in)
    const programareExistenta = await getDb().get('SELECT * FROM programare WHERE id_pacient = ? AND id_medic = ? AND data = ? AND status = "programata"', [id_pacient, id_medic, azi]);
    if (programareExistenta) {
      return res.status(200).json({ message: 'Ai deja o programare activă la acest medic pentru astăzi. Te rugăm să folosești butonul "Anunță că am ajuns".' });
    }
    // 4. Pentru walk-in: plasează după TOATE programările din ziua respectivă, indiferent de ora sosirii
    // Ia toate programările ordonate după oră
    const programari = await getDb().all('SELECT id_pacient, ora FROM programare WHERE id_medic = ? AND data = ? AND status = "programata" ORDER BY ora ASC', [id_medic, azi]);
    
    // Ia toți pacienții deja în coadă (prezenți fizic)
    let coada = await getDb().all('SELECT * FROM coada_asteptare WHERE id_medic = ? AND data = ? AND status IN ("in_asteptare", "asteptat", "in_consultatie") ORDER BY ora_sosire ASC', [id_medic, azi]);
    // Elimină dublurile: dacă pacientul e deja în coadă, nu-l mai adăuga
    if (coada.some(c => c.id_pacient == id_pacient)) {
      return res.status(200).json({ message: 'Ești deja în coadă la acest medic pentru astăzi.' });
    }
    
    // Calculează ora_sosire pentru walk-in astfel încât să fie plasat după TOATE programările din ziua respectivă
    let oraSosireWalkin = ora;
    if (programari.length > 0) {
      // Găsește ultima programare din zi pentru a plasa walk-in-ul după ea
      const ultimaProgramare = programari[programari.length - 1];
      const [h, m] = ultimaProgramare.ora.split(":").map(Number);
      // Adaugă 1 minut după ultima programare pentru a fi sigur că e după
      const oraWalkin = new Date();
      oraWalkin.setHours(h, m + 1, 0, 0);
      oraSosireWalkin = oraWalkin.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    
    // Inserarea în DB cu ora_sosire calculată pentru poziționare corectă
    await getDb().run('INSERT INTO coada_asteptare (id_pacient, id_medic, data, ora_sosire, status) VALUES (?, ?, ?, ?, "in_asteptare")', [id_pacient, id_medic, azi, oraSosireWalkin]);
    const io = req.app.get('io');
    if (io) {
      io.to('medic_' + id_medic).emit('queue-updated', { id_medic });
      io.to('pacient_' + id_pacient).emit('status-updated', { id_pacient, id_medic });
    }
    return res.status(201).json({ message: 'Ai fost adăugat(ă) la coadă după programările din față!' });
  } catch (err) {
    res.status(500).json({ message: 'Eroare la adăugarea la coadă', error: err.message });
  }
};

// Status/poziție pacient în coadă (ordonare cu in_consultatie primul)
exports.statusPacientCoada = async (req, res) => {
  try {
    // Acceptă parametri din query sau params
    const id_medic = req.params.id_medic || req.params.id || req.query.medic;
    const id_pacient = req.params.id_pacient || req.query.pacient || req.query.id_pacient;
    const data = req.params.data || req.query.data;
    console.log('[DEBUG statusPacientCoada] id_medic:', id_medic, 'id_pacient:', id_pacient, 'data:', data);
    if (!id_medic || !id_pacient || !data) {
      return res.status(400).json({ message: 'Parametri lipsă' });
    }
    const now = new Date();
    // Găsește toți pacienții în coadă
    let coada = await getDb().all('SELECT id_pacient, status, ora_sosire FROM coada_asteptare WHERE id_medic = ? AND data = ? AND status IN ("in_asteptare", "asteptat", "in_consultatie")', [id_medic, data]);
    // --- NOU: Adaugă programările viitoare (neanulate, nefinalizate) ca "rezervat" ---
    const limitaIntarziereMin = 10; // minute de "grație" după ora programării
    const programari = await getDb().all('SELECT id_pacient, ora FROM programare WHERE id_medic = ? AND data = ? AND status = "programata"', [id_medic, data]);
    for (const prog of programari) {
      // Verifică dacă pacientul cu programare este deja în coadă cu status activ
      const pacientInCoada = coada.find(c => String(c.id_pacient) === String(prog.id_pacient));
      if (!pacientInCoada) {
        // Pacientul nu este în coadă, adaugă-l ca "rezervat"
        const [h, m] = prog.ora.split(":").map(Number);
        const progDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        const limitaDate = new Date(progDate.getTime() + limitaIntarziereMin*60000);
        if (now <= limitaDate) {
          coada.push({ id_pacient: prog.id_pacient, status: 'rezervat', ora_sosire: prog.ora });
        }
      }
      // Dacă pacientul este deja în coadă, păstrează statusul său actual (in_asteptare, asteptat, etc.)
    }
    // Ordonează: in_consultatie primul, apoi după ora_sosire (inclusiv "rezervat")
    coada = coada.sort((a, b) => {
      if (a.status === 'in_consultatie') return -1;
      if (b.status === 'in_consultatie') return 1;
      return a.ora_sosire.localeCompare(b.ora_sosire);
    });
    console.log('[DEBUG statusPacientCoada] Coada extinsă:', coada);
    let pozitie = null, status = null;
    for (let i = 0; i < coada.length; i++) {
      if (String(coada[i].id_pacient) === String(id_pacient)) {
        pozitie = i + 1;
        status = coada[i].status;
        break;
      }
    }
    if (pozitie === null) {
      // Verifică dacă există o consultație finalizată pentru acest pacient, medic și dată
      const consultatie = await getDb().get(
        `SELECT ora_start, ora_sfarsit FROM consultatie WHERE id_pacient = ? AND id_medic = ? AND data = ?`,
        [id_pacient, id_medic, data]
      );
      if (consultatie) {
        return res.json({
          status: 'finalizat',
          consultatie_finalizata: true,
          ora_start: consultatie.ora_start,
          ora_sfarsit: consultatie.ora_sfarsit
        });
      }
      // Dacă nu există nici consultație, returnează 404 ca înainte
      return res.status(404).json({ message: 'Nu ești în coadă la acest medic.' });
    }
    const persoane_in_fata = pozitie - 1;
    const stat2 = await getDb().get('SELECT durata_medie_consultatie FROM statistica WHERE id_medic = ? AND data = ?', [id_medic, data]);
    let durata_medie_consultatie2 = stat2 && stat2.durata_medie_consultatie ? Math.round(stat2.durata_medie_consultatie) : null;
    if (!durata_medie_consultatie2) {
      const resultMedie = await getDb().get('SELECT AVG(durata) as durata_medie FROM consultatie WHERE id_medic = ? AND durata > 0 AND data >= date(\'now\', \'-30 days\')', [id_medic]);
      durata_medie_consultatie2 = resultMedie && resultMedie.durata_medie ? Math.round(resultMedie.durata_medie) : 30;
    }
    if (durata_medie_consultatie2 <= 0 || isNaN(durata_medie_consultatie2)) durata_medie_consultatie2 = 30;
    const timp_estimare2 = persoane_in_fata * durata_medie_consultatie2;
    res.json({ pozitie, status, persoane_in_fata, timp_estimare: timp_estimare2, durata_medie_consultatie: durata_medie_consultatie2 });
  } catch (err) {
    console.error('Eroare la status pacient coadă:', err);
    res.status(500).json({ message: 'Eroare la status pacient coadă', error: err.message });
  }
};

// Anulează prezența la coadă pentru un pacient
exports.anuleazaCoada = async (req, res) => {
  try {
    const { id_pacient, data } = req.body;
    const id_medic = req.params.id;
    if (!id_pacient || !id_medic || !data) {
      return res.status(400).json({ message: 'Lipsesc datele necesare (id_pacient, id_medic, data)' });
    }
    const result = await getDb().run(
      `UPDATE coada_asteptare SET status = 'anulat' WHERE id_pacient = ? AND id_medic = ? AND data = ? AND status IN ('in_asteptare', 'asteptat')`,
      [id_pacient, id_medic, data]
    );
    if (result.changes > 0) {
      // Emitere eveniment Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.to('medic_' + id_medic).emit('queue-updated', { id_medic });
        io.to('pacient_' + id_pacient).emit('status-updated', { id_pacient, id_medic });
      }
      res.json({ message: 'Prezența la coadă a fost anulată cu succes.' });
    } else {
      res.status(404).json({ message: 'Nu există o prezență activă la coadă pentru acest utilizator.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Eroare la anularea prezenței la coadă', error: err.message });
  }
};

// Acceptă un pacient din coadă
exports.acceptaPacient = async (req, res) => {
  try {
    const { id_pacient, data } = req.body;
    const id_medic = req.params.id;
    if (!id_medic || !id_pacient || !data) {
      return res.status(400).json({ message: 'Lipsesc datele necesare (id_medic, id_pacient, data)' });
    }
    // --- NOU: setează ora_sosire dacă nu e validă ---
    const pacient = await getDb().get(
      'SELECT ora_sosire FROM coada_asteptare WHERE id_medic = ? AND id_pacient = ? AND data = ?',
      [id_medic, id_pacient, data]
    );
    if (!pacient.ora_sosire || pacient.ora_sosire === '' || pacient.ora_sosire === 'nu_a_ajuns') {
      const ora_sosire = new Date().toLocaleTimeString('ro-RO', { hour12: false });
      await getDb().run(
        'UPDATE coada_asteptare SET ora_sosire = ? WHERE id_medic = ? AND id_pacient = ? AND data = ?',
        [ora_sosire, id_medic, id_pacient, data]
      );
    }
    // Setează statusul 'in_consultatie' pentru pacientul acceptat
    const result = await getDb().run(
      'UPDATE coada_asteptare SET status = "in_consultatie" WHERE id_medic = ? AND id_pacient = ? AND data = ? AND status = "in_asteptare"',
      [id_medic, id_pacient, data]
    );
    if (result.changes > 0) {
      console.log(`[COADA] Pacientul ${id_pacient} a fost acceptat în consultație la medicul ${id_medic} pentru data ${data}`);
      // Emitere eveniment Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.to('medic_' + id_medic).emit('queue-updated', { id_medic });
        io.to('pacient_' + id_pacient).emit('status-updated', { id_pacient, id_medic });
      }
      res.json({ message: 'Pacientul a fost acceptat în consultație.' });
    } else {
      res.status(404).json({ message: 'Pacientul nu este în coadă sau nu poate fi acceptat.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Eroare la acceptarea pacientului', error: err.message });
  }
}; 