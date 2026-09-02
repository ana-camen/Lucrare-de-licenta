document.addEventListener('DOMContentLoaded', async () => {
  const welcomeSection = document.getElementById('welcome-section');
  const selectionSection = document.getElementById('selection-section');
  const queueSection = document.getElementById('queue-section');
  const specializareSelect = document.getElementById('specializare');
  const medicSelect = document.getElementById('medic');
  const infoCoada = document.getElementById('info-coada');
  const optiuniUtilizator = document.getElementById('optiuni-utilizator');
  const menuDiv = document.querySelector('.menu');

  let intervalCoada = null;

  // === SOCKET.IO pentru update real-time status personal ===
  let socket;

  // --- CURĂȚARE SESSIONSTORAGE LA ÎNTRAREA PE PAGINA DE SCANARE COD ---
  // Elimină statusurile vechi pentru a permite selectarea din nou a medicului
  // PĂSTREAZĂ doar dacă venim direct de la finalizarea unei consultații
  const urlParamsConsultation = new URLSearchParams(window.location.search);
  const fromConsultation = urlParamsConsultation.get('fromConsultation');
  
  if (!fromConsultation) {
    // Nu venim de la finalizarea consultației, curăță sessionStorage
    sessionStorage.removeItem('scanare_cod_medic_id');
    sessionStorage.removeItem('scanare_cod_specializare');
    sessionStorage.removeItem('scanare_cod_state');
    // Curăță și statusurile specifice medicilor
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('scanare_cod_state_')) {
        sessionStorage.removeItem(key);
      }
    });
  }

  // --- Mutăm funcția globală aici pentru a fi disponibilă la restaurare ---
  let intervalStatusPersonal = null;
  window.afiseazaStatusPersonalCoada = async function(idMedic, idPacient, isInitialCall = true) {
    try {
      if (!idMedic || !idPacient) {
        afiseazaEroareVizibila('Date lipsă: nu se poate determina medicul sau utilizatorul.');
        return;
      }
      if (typeof intervalCoada !== 'undefined' && intervalCoada) clearInterval(intervalCoada);
      
      // Obține informații despre medic
      const resMedic = await fetch(`/api/medic/${idMedic}`);
      let medicNume = '', specializare = '';
      if (resMedic.ok) {
        const medic = await resMedic.json();
        medicNume = medic.nume;
        specializare = medic.specializare;
      }
      
      // Folosește data locală pentru a evita probleme cu timezone-ul
      const now = new Date();
      const azi = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      console.log('Data trimisă către backend:', azi, 'Data completă:', new Date().toISOString());
      let resPoz;
      try {
        resPoz = await fetch(`/api/coada/status_pacient/${idPacient}/${idMedic}/${azi}`);
      } catch (err) {
        // Dacă fetch-ul eșuează complet (ex: server down), tratează ca eroare
        console.error('Eroare la fetch /api/coada:', err);
        afiseazaMesajEroare();
        oprestePolling();
        return;
      }
      if (resPoz.status === 404) {
        // Nu e în coadă și nu are programare, revino la selecție fără alertă
        sessionStorage.removeItem('scanare_cod_medic_id');
        sessionStorage.removeItem('scanare_cod_specializare');
        sessionStorage.removeItem('scanare_cod_state');
        selectionSection.style.display = 'block';
        queueSection.style.display = 'none';
        populeazaSpecializari();
        return;
      }
      
      if (resPoz.ok) {
        const data = await resPoz.json();
        console.log('Status personal coada:', data);
        console.log('Status primit:', data.status, 'Consultatie finalizata:', data.consultatie_finalizata);
        console.log('Persoane in fata:', data.persoane_in_fata, 'Timp estimat:', data.timp_estimare);
        
        // Salvează starea în sessionStorage pentru persistență
        sessionStorage.setItem('scanare_cod_medic_id', idMedic);
        
        // Procesează diferitele statusuri
        if (data.consultatie_finalizata || data.status === 'finalizat') {
          // CONSULTAȚIE FINALIZATĂ - afișează mesajul și permite revenirea la selecție
          sessionStorage.setItem('scanare_cod_state_' + idMedic, 'finalizat');
          welcomeSection.style.display = 'none';
          selectionSection.style.display = 'none';
          queueSection.style.display = 'block';
          afiseazaMesajFinalizare(medicNume, specializare, data.ora_start, data.ora_sfarsit);
          // Adaugă buton pentru revenirea la selecție
          setTimeout(() => {
            const btnRevenire = document.createElement('button');
            btnRevenire.className = 'btn btn-primary';
            btnRevenire.style.marginTop = '15px';
            btnRevenire.textContent = 'Revino la selecție medic';
            btnRevenire.onclick = () => {
              sessionStorage.removeItem('scanare_cod_medic_id');
              sessionStorage.removeItem('scanare_cod_specializare');
              sessionStorage.removeItem('scanare_cod_state');
              welcomeSection.style.display = 'none';
              selectionSection.style.display = 'block';
              queueSection.style.display = 'none';
              populeazaSpecializari();
            };
            infoCoada.appendChild(btnRevenire);
          }, 100);
          oprestePolling();
          return;
        }
        
        if (data.status === 'asteptat') {
          // PACIENT ACCEPTAT ÎN CABINET
          sessionStorage.setItem('scanare_cod_state_' + idMedic, 'asteptat');
          welcomeSection.style.display = 'none';
          selectionSection.style.display = 'none';
          queueSection.style.display = 'block';
          afiseazaMesajAsteptat(medicNume, specializare, data.nume_medic, data.ora_inceput);
          oprestePolling();
          return;
        }
        
        if (data.status === 'in_consultatie') {
          sessionStorage.setItem('scanare_cod_state_' + idMedic, 'in_consultatie');
          welcomeSection.style.display = 'none';
          selectionSection.style.display = 'none';
          queueSection.style.display = 'block';
          afiseazaMesajInConsultatie(medicNume, specializare);
          oprestePolling();
          return;
        }
        
        if (data.status === 'in_asteptare') {
          sessionStorage.setItem('scanare_cod_state_' + idMedic, 'in_coada');
          console.log('Pacient in asteptare - persoane in fata:', data.persoane_in_fata, 'timp estimat:', data.timp_estimare);
          
          // Asigură-te că secțiunea de coadă este vizibilă
          welcomeSection.style.display = 'none';
          selectionSection.style.display = 'none';
          queueSection.style.display = 'block';
          
          // Afișează întotdeauna mesajul cu poziția în coadă, nu "următorul la rând"
          // chiar dacă persoane_in_fata este 0 (pentru că ar putea fi primul din coadă)
          afiseazaMesajInCoada(medicNume, specializare, data.persoane_in_fata || 0, data.timp_estimare || 0);
          
          afiseazaOptiuniCoada(idMedic, { programare: !!data.ora_programare }, idPacient, azi);
          if (isInitialCall) {
            pornestePolling(idMedic, idPacient);
          }
          return;
        }
        
        // === NOU: Tratament pentru statusul 'programat' ===
        if (data.status === 'programat') {
          sessionStorage.setItem('scanare_cod_state_' + idMedic, 'selection');
          welcomeSection.style.display = 'none';
          selectionSection.style.display = 'none';
          queueSection.style.display = 'block';
          // Afișează mesaj cu ora programării și butonul 'Anunță că am ajuns'
          const statusClass = 'programat';
          const icon = '<i class="fas fa-calendar-check icon"></i>';
          const mesaj = `
            <div style='margin-bottom:10px;color:#007bff;font-size:1.13em;font-weight:500;'>Ai programare la ora <b>${data.ora_programare}</b>.</div>
            <button id="btn-anunta-sosire" class="btn-sosire">Anunță că am ajuns</button>
          `;
          afiseazaMesaj(statusClass, icon + mesaj);
          setTimeout(() => {
            const btnSosire = document.getElementById('btn-anunta-sosire');
            if (btnSosire) {
              btnSosire.onclick = async () => {
                try {
                  await fetch(`/api/coada/${idMedic}/adauga`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_pacient: idPacient, data: azi, programare: true })
                  });
                  await window.afiseazaStatusPersonalCoada(idMedic, idPacient);
                } catch (err) {
                  console.error('Eroare la anunțarea sosirii:', err);
                  alert('A apărut o eroare la anunțarea sosirii. Încearcă din nou.');
                }
              };
            }
          }, 100);
          oprestePolling();
          return;
        }
      } else {
        // PACIENT NU ESTE ÎN COADĂ
        // Verifică dacă există vreo stare anterioară (ex: a fost în coadă sau programat)
        const state = sessionStorage.getItem('scanare_cod_state_' + idMedic);
        if (isInitialCall && (state === 'in_coada' || state === 'asteptat' || state === 'finalizat' || state === 'programat')) {
          // Dacă este refresh, nu afișa avertizare, ci revino la selecție fără alertă
          sessionStorage.removeItem('scanare_cod_medic_id');
          sessionStorage.removeItem('scanare_cod_specializare');
          sessionStorage.removeItem('scanare_cod_state');
          selectionSection.style.display = 'block';
          queueSection.style.display = 'none';
          populeazaSpecializari();
          return;
        } else if (state === 'in_coada' || state === 'asteptat' || state === 'finalizat' || state === 'programat') {
          afiseazaMesajNuInCoada(medicNume, specializare);
          oprestePolling();
        } else {
          // Nu are programare și nu e în coadă: revino la selecție
          selectionSection.style.display = 'block';
          queueSection.style.display = 'none';
        }
        return;
      }
    } catch (err) {
      console.error('Eroare la încărcarea situației cozii:', err);
      afiseazaEroareVizibila('A apărut o eroare la încărcarea situației cozii. Încearcă din nou sau contactează administratorul.');
      oprestePolling();
    }
  };

  // --- NOU: Actualizează meniul cu nume/prenume dacă ești logat ---
  const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
  const userId = sessionStorage.getItem('userId');
  if (isLoggedIn && userId) {
    // Preia datele pacientului și actualizează meniul
    try {
      const res = await fetch(`/api/pacient/${userId}`);
      if (res.ok) {
        const pacient = await res.json();
        if (menuDiv) {
          menuDiv.innerHTML = `<a href='/html/pacient.html'><i class='fas fa-home'></i> Acasă</a><span class='user-menu'><i class='fas fa-user'></i> ${pacient.nume} ${pacient.prenume}</span>`;
        }
      }
    } catch (err) {}
    
    // Dacă nu a fost consultat, continuă cu flow-ul normal
    welcomeSection.style.display = 'none';
    selectionSection.style.display = 'block';
    queueSection.style.display = 'none';
    populeazaSpecializari();

    // Dacă nu ai deja socket.io client, adaugă-l dinamic
    if (typeof io === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = () => {
        socket = io();
        socket.emit('join-pacient-room', userId);
        socket.on('status-updated', (data) => {
          // Data ar trebui să conțină id_medic
          const medicId = sessionStorage.getItem('scanare_cod_medic_id');
          if (medicId && userId) {
            window.afiseazaStatusPersonalCoada(medicId, userId, false);
          }
        });
      };
      document.head.appendChild(script);
    } else {
      socket = io();
      socket.emit('join-pacient-room', userId);
      socket.on('status-updated', (data) => {
        const medicId = sessionStorage.getItem('scanare_cod_medic_id');
        if (medicId && userId) {
          window.afiseazaStatusPersonalCoada(medicId, userId, false);
        }
      });
    }

    // După populare specializări, dacă există medic selectat, verifică statusul
    const medicIdLogin = sessionStorage.getItem('scanare_cod_medic_id');
    if (medicIdLogin) {
      verificaStatusDupaLoginSauSelectie(medicIdLogin, userId);
    }
  }

  // === RESTAURARE STARE DUPĂ REFRESH ===
  // ELIMINAT: Nu mai restaurăm starea veche, începem mereu cu o stare curată
  // const savedMedicId = sessionStorage.getItem('scanare_cod_medic_id');
  // const savedSpecializare = sessionStorage.getItem('scanare_cod_specializare');
  // const savedState = sessionStorage.getItem('scanare_cod_state');
  
  // if (savedMedicId && isLoggedIn && userId) {
  //   // Indiferent de savedState, refacem statusul personal la refresh
  //   welcomeSection.style.display = 'none';
  //   selectionSection.style.display = 'none';
  //   queueSection.style.display = 'block';
  //   await afiseazaStatusPersonalCoada(savedMedicId, userId, false);
  //   // După apel, verificăm dacă statusul nu mai este valid
  //   const state = sessionStorage.getItem('scanare_cod_state_' + savedMedicId);
  //   if (!(state === 'in_coada' || state === 'asteptat' || state === 'finalizat' || state === 'programat')) {
  //     // Statusul nu mai e valid, revenim la selecție și curățăm sessionStorage
  //     sessionStorage.removeItem('scanare_cod_medic_id');
  //     sessionStorage.removeItem('scanare_cod_specializare');
  //     sessionStorage.removeItem('scanare_cod_state');
  //     selectionSection.style.display = 'block';
  //     queueSection.style.display = 'none';
  //     populeazaSpecializari();
  //   }
  // }

  // Execută logica de programare doar dacă venim din scanare QR (returnTo sau direct pe scanare_cod.html)
  const urlParams = new URLSearchParams(window.location.search);
  const fromReturnTo = urlParams.has('returnTo') || window.location.pathname.includes('scanare_cod.html');
  const azi = new Date().toISOString().split('T')[0];
  if (fromReturnTo && isLoggedIn && userId) {
    try {
      // const res = await fetch(`/api/programari/${userId}?t=${Date.now()}`);
      // const programari = await res.json();
      // const progAzi = programari.find(p => p.data === azi && p.status !== 'anulata');
      // if (progAzi) {
      //   afiseazaSituatiaCozii(progAzi.id_medic, true, true);
      //   welcomeSection.style.display = 'none';
      //   selectionSection.style.display = 'none';
      //   queueSection.style.display = 'block';
      //   return;
      // }
      // Nu mai face redirect automat la coadă, lasă utilizatorul să selecteze medicul
    } catch (err) {
      console.error('Eroare la verificarea programărilor:', err);
    }
  }
  // Dacă nu are programare azi, continuă cu flow-ul normal

  // Funcție pentru a afișa secțiunea de selectare (după scanare QR)
  function afiseazaSelectare() {
    welcomeSection.style.display = 'none';
    selectionSection.style.display = 'block';
    queueSection.style.display = 'none';
    populeazaSpecializari();
  }

  // Populează specializările
  async function populeazaSpecializari() {
    try {
      const res = await fetch('/api/medici/specializari');
      const specializari = await res.json();
      specializareSelect.innerHTML = '<option value="">-- Selectează specializarea --</option>';
      specializari.forEach(sp => {
        const opt = document.createElement('option');
        opt.value = sp;
        opt.textContent = sp;
        specializareSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Eroare la încărcarea specializărilor:', err);
      afiseazaEroareVizibila('Nu s-au putut încărca specializările.');
    }
  }

  // Populează medicii pentru specializarea selectată
  async function populeazaMedici(specializare) {
    try {
      const res = await fetch(`/api/medici/specializare?specializare=${encodeURIComponent(specializare)}`);
      const medici = await res.json();
      medicSelect.innerHTML = '<option value="">-- Selectează medicul --</option>';
      medici.forEach(medic => {
        const opt = document.createElement('option');
        opt.value = medic.id_medic;
        opt.textContent = `${medic.nume} (Rating: ${Number(medic.rating).toFixed(2)}/5)`;
        medicSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Eroare la încărcarea medicilor:', err);
      afiseazaEroareVizibila('Nu s-au putut încărca medicii pentru specializarea selectată.');
    }
  }

  // Creează butonul de afișare coadă cu clasă specială pentru stilizare
  const btnAfiseazaCoada = document.createElement('button');
  btnAfiseazaCoada.className = 'btn btn-primary btn-afiseaza-coada';
  btnAfiseazaCoada.textContent = 'Vezi coada';
  btnAfiseazaCoada.style.display = 'none';
  selectionSection.appendChild(btnAfiseazaCoada);
  console.log('[DEBUG] Butonul Vezi coada a fost creat și adăugat în DOM:', btnAfiseazaCoada);

  let idMedicSelectat = null;
  let specializareSelectata = null;

  specializareSelect.addEventListener('change', (e) => {
    const specializare = e.target.value;
    specializareSelectata = specializare;
    if (specializare) {
      sessionStorage.setItem('scanare_cod_specializare', specializare);
      sessionStorage.setItem('scanare_cod_state', 'selection');
      populeazaMedici(specializare);
      btnAfiseazaCoada.style.display = 'none';
    } else {
      sessionStorage.removeItem('scanare_cod_specializare');
      sessionStorage.removeItem('scanare_cod_medic_id');
      sessionStorage.removeItem('scanare_cod_state');
      medicSelect.innerHTML = '<option value="">-- Selectează medicul --</option>';
      btnAfiseazaCoada.style.display = 'none';
    }
  });

  // La selectarea unui medic, verifică statusul înainte de a permite punerea la coadă
  medicSelect.addEventListener('change', async (e) => {
    idMedicSelectat = e.target.value;
    const userId = sessionStorage.getItem('userId');
    if (idMedicSelectat) {
      sessionStorage.setItem('scanare_cod_medic_id', idMedicSelectat);
      sessionStorage.setItem('scanare_cod_state_' + idMedicSelectat, 'selection');
      infoCoada.innerHTML = '';
      infoCoada.className = 'info-coada';
     // optiuniUtilizator.innerHTML = '';
      btnAfiseazaCoada.style.display = '';
      // Nu afișa coada aici, doar butonul
    } else {
      sessionStorage.removeItem('scanare_cod_medic_id');
      if (idMedicSelectat) sessionStorage.removeItem('scanare_cod_state_' + idMedicSelectat);
      infoCoada.innerHTML = '';
      optiuniUtilizator.innerHTML = '';
      btnAfiseazaCoada.style.display = 'none';
    }
  });

  btnAfiseazaCoada.addEventListener('click', async () => {
    if (!idMedicSelectat || !userId) {
      afiseazaEroareVizibila('Date lipsă: selectează un medic și asigură-te că ești autentificat.');
      return;
    }
    // După click, ascunde selecția și arată statusul cozii
    selectionSection.style.display = 'none';
    queueSection.style.display = 'block';
    // Verifică dacă pacientul este deja la coadă
    const azi = new Date().toISOString().split('T')[0];
    let statusReal = null;
    try {
      const res = await fetch(`/api/coada/status_pacient/${userId}/${idMedicSelectat}/${azi}`);
      if (res.ok) {
        const data = await res.json();
        if (["in_asteptare", "asteptat", "in_consultatie"].includes(data.status)) {
          statusReal = data.status;
        }
      }
    } catch {}
    if (statusReal) {
      await window.afiseazaStatusPersonalCoada(idMedicSelectat, userId, true);
    } else {
      // Pacientul NU este la coadă, deci permite afișarea butonului 'Pune-te la coadă'
      await afiseazaSituatiaCoziiNoua(idMedicSelectat, isLoggedIn, true); // transmit flag suplimentar
    }
  });

  // Funcție pentru afișarea situației cozii (pentru utilizatori neautentificați sau pentru simulare)
  async function afiseazaSituatiaCoziiNoua(idMedic, isLoggedIn, allowPuneLaCoada = false) {
    try {
      const userId = sessionStorage.getItem('userId') || '-1';
      if (!idMedic) {
        afiseazaEroareVizibila('Nu a fost selectat niciun medic.');
        return;
      }
      if (!userId || userId === '-1') {
        afiseazaEroareVizibila('Trebuie să fii autentificat pentru a intra la coadă.');
        return;
      }
      const azi = new Date().toISOString().split('T')[0];
      
      // Obține informații despre medic
      let medicNume = '', specializare = '';
      try {
        const resMedic = await fetch(`/api/medic/${idMedic}`);
        if (resMedic.ok) {
          const medic = await resMedic.json();
          medicNume = medic.nume;
          specializare = medic.specializare;
        }
      } catch {}
      
      // Verifică dacă pacientul are programare
      let mesajProgramare = '';
      if (userId !== '-1') {
        try {
          const resProg = await fetch(`/api/programari/verifica/${userId}/${idMedic}/${azi}`);
          if (resProg.ok) {
            const prog = await resProg.json();
            if (prog.areProgramare && prog.ora) {
              mesajProgramare = `<div style='margin-bottom:10px;color:#007bff;font-size:1.13em;font-weight:500;'>Ai programare la Dr. ${medicNume} (${specializare}) la ora <b>${prog.ora}</b>.</div>`;
            }
          }
        } catch {}
      }
      
      // Verifică dacă pacientul este deja în coadă la acest medic (pentru recunoaștere după refresh)
      let pacientInCoada = null;
      if (userId !== '-1') {
        try {
          console.log('DEBUG status fetch:', { userId, idMedic, azi });
          const resStatus = await fetch(`/api/coada/status_pacient/${userId}/${idMedic}/${azi}`);
          if (resStatus.ok) {
            pacientInCoada = await resStatus.json();
          }
        } catch (error) {
          console.log('Pacientul nu este în coadă sau eroare la verificare');
        }
      }
      
      // Obține simularea cozii
      const res = await fetch(`/api/coada_simulare/${idMedic}/${azi}/${userId}`);
      const simulare = await res.json();
      
      // --- NOU: Loguri pentru debug ---
      console.log('Frontend: Simulare primita de la backend:', simulare);
      console.log('Frontend: persoane_in_fata =', simulare.persoane_in_fata);
      console.log('Frontend: timp_estimare =', simulare.timp_estimare);
      
      let fallbackWalkin = false;
      if (!simulare || typeof simulare.persoane_in_fata === 'undefined') {
        fallbackWalkin = true;
      }
      let statusClass = 'ok';
      let icon = '<i class="fas fa-user-clock icon"></i>';
      let mesaj = '';
      if (fallbackWalkin) {
        mesaj = `<div style='margin:8px 0;'><b>Status coadă:</b> <span style='color:#1a7f1a;font-size:1.1em;font-weight:600;'>Poți intra la coadă</span></div><div style='margin:8px 0;'><b>Timp estimat:</b> <span style='color:#1a7f1a;font-size:1.1em;font-weight:600;'>Necunoscut</span></div>`;
      } else if (simulare.programare) {
        // Pacient cu programare
        mesaj = `<div class="mesaj-programare">Ai programare la ora <b>${simulare.nextProgOra}</b>.</div>`;
        if (!simulare.ora_sosire) {
          mesaj += `<button id="btn-anunta-sosire" class="btn-sosire">Anunță că ai ajuns</button>`;
        } else {
          mesaj += `<div class="ora-sosire">Ai anunțat sosirea la ora <b>${simulare.ora_sosire}</b>.</div>`;
        }
      } else {
        // --- NOU: Verificare explicită pentru coada goală ---
        if (simulare.persoane_in_fata === 0 || simulare.persoane_in_fata === null || simulare.persoane_in_fata === undefined) {
          mesaj = `<div style='margin:8px 0;'><b>Status coadă:</b> <span style='color:#1a7f1a;font-size:1.1em;font-weight:600;'>Liber</span></div><div style='margin:8px 0;'><b>Timp estimat:</b> <span style='color:#1a7f1a;font-size:1.1em;font-weight:600;'>Imediat</span></div>`;
        } else {
          mesaj = `<div style='margin:8px 0;'><b>Persoane în față:</b> <span style='color:#d35400;font-size:1.1em;font-weight:600;'>${simulare.persoane_in_fata}</span></div><div style='margin:8px 0;'><b>Timp estimat de așteptare:</b> <span style='color:#d35400;font-size:1.1em;font-weight:600;'>${Math.round(simulare.timp_estimare)} minute</span></div>`;
        }
      }
      
      infoCoada.className = 'info-coada ' + statusClass;
      infoCoada.innerHTML = `${icon} ${mesajProgramare}${mesaj}`;
      optiuniUtilizator.innerHTML = '';
      selectionSection.style.display = 'none';
      queueSection.style.display = 'block';
      
      // Afișează opțiuni pentru walk-in chiar dacă nu există status clar
      afiseazaOptiuniCoada(idMedic, simulare || { programare: false }, userId, azi, allowPuneLaCoada);
      
      // Butonul "Anunță că ai ajuns" pentru programare
      setTimeout(() => {
        const btnSosire = document.getElementById('btn-anunta-sosire');
        if (btnSosire) {
          btnSosire.onclick = async () => {
            await fetch(`/api/coada/${idMedic}/adauga`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id_pacient: userId, data: azi, programare: true })
            });
            await window.afiseazaStatusPersonalCoada(idMedic, userId);
          };
        }
      }, 100);
      
      // Polling pentru simulare
      if (intervalCoada) clearInterval(intervalCoada);
      intervalCoada = setInterval(() => afiseazaSituatiaCoziiNoua(idMedic, isLoggedIn, allowPuneLaCoada), 15000);
    } catch (err) {
      console.error('Eroare la încărcarea situației cozii (simulare):', err);
      afiseazaEroareVizibila('A apărut o eroare la simularea cozii.');
    }
  }

  // În funcția afiseazaOptiuniCoada, la click pe btn, dropdown-ul rămâne deschis până la click explicit în afara lui sau pe buton, fără să fie ascuns la refresh de status sau re-randare.
  // Adaug un flag global pentru dropdown deschis și nu îl ascund la re-randare.
  let dropdownDeschis = false;
  function afiseazaOptiuniCoada(idMedic, simulare, userId, azi, allowPuneLaCoada = false) {
    try {
      infoCoada.innerHTML += `
        <div class="dropdown-container">
          <button id="btn-optiuni" class="btn-optiuni" style="margin-top:12px;">Vezi opțiuni</button>
          <div id="dropdown-optiuni" class="dropdown-optiuni" style="display:none;"></div>
        </div>
      `;
      setTimeout(() => {
        const container = infoCoada.querySelector('.dropdown-container');
        const btn = container.querySelector('#btn-optiuni');
        const dropdown = container.querySelector('#dropdown-optiuni');
        if (btn && dropdown) {
          // --- Păstrează starea dropdown-ului la re-randare ---
          if (dropdownDeschis) {
            dropdown.style.display = 'flex';
            document.addEventListener('mousedown', clickOutsideDropdown, true);
          }
          btn.onclick = (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
            dropdownDeschis = dropdown.style.display === 'flex';
            if (dropdownDeschis) {
              document.addEventListener('mousedown', clickOutsideDropdown, true);
            } else {
              document.removeEventListener('mousedown', clickOutsideDropdown, true);
            }
            let optiuni = '';
            
            if (simulare.programare) {
              // Are programare, dar nu a anunțat sosirea
              optiuni += `<button class='dropdown-item' id='btn-anunta-sosire'>Anunță că am ajuns</button>`;
              optiuni += `<button class='dropdown-item' id='btn-programeaza-altadata'>Fă o programare în altă zi</button>`;
              optiuni += `<button class='dropdown-item' id='btn-anuleaza-pleaca'>Anulează și pleacă</button>`;
            } else {
              // Walk-in
              // Afișează butonul doar dacă allowPuneLaCoada este true
              if (allowPuneLaCoada) {
                optiuni += `<button class='dropdown-item' id='btn-pune-coada'>Pune-te la coadă</button>`;
              }
              optiuni += `<button class='dropdown-item' id='btn-programeaza-altadata'>Fă o programare în altă zi</button>`;
              if (Number(simulare.timp_estimare) > 60) {
                optiuni += `<div style='color:#1976d2;font-size:0.98em;padding:4px 18px 0 18px;'>Sugestie: Pentru confortul tău, poți face o programare în altă zi.</div>`;
              }
              optiuni += `<button class='dropdown-item' id='btn-anuleaza-pleaca'>Anulează și pleacă</button>`;
            }
            
            dropdown.innerHTML = optiuni;

            // Delegare eveniment pentru butoanele generate dinamic
            dropdown.addEventListener('click', async function(e) {
              if (e.target && e.target.id === 'btn-pune-coada') {
                const btn = e.target;
                btn.disabled = true;
                try {
                  await window.puneLaCoada(idMedic);
                } catch (err) {
                  btn.disabled = false;
                  console.error('Eroare la punerea la coadă:', err);
                  afiseazaEroareVizibila('A apărut o eroare la punerea la coadă. Încearcă din nou.');
                }
              }
              if (e.target && e.target.id === 'btn-anunta-sosire') {
                try {
                  await fetch(`/api/coada/${idMedic}/adauga`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_pacient: userId, data: azi, programare: true })
                  });
                  await window.afiseazaStatusPersonalCoada(idMedic, userId);
                } catch (err) {
                  console.error('Eroare la anunțarea sosirii:', err);
                  alert('A apărut o eroare la anunțarea sosirii. Încearcă din nou.');
                }
              }
              if (e.target && e.target.id === 'btn-anuleaza-pleaca') {
                try {
                  // Dacă pacientul este în coadă, anulează coada
                  if (userId && userId !== '-1') {
                    const response = await fetch(`/api/coada/${idMedic}/anuleaza`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id_pacient: userId, data: azi })
                    });
                    const result = await response.json();
                    console.log('[DEBUG] Răspuns anulare:', result);
                  }
                  
                  // Curăță sessionStorage și revino la selecție
                  sessionStorage.removeItem('scanare_cod_medic_id');
                  sessionStorage.removeItem('scanare_cod_specializare');
                  sessionStorage.removeItem('scanare_cod_state');
                  
                  // Curăță și statusurile specifice medicilor
                  Object.keys(sessionStorage).forEach(key => {
                    if (key.startsWith('scanare_cod_state_')) {
                      sessionStorage.removeItem(key);
                    }
                  });
                  
                  // Oprește polling-ul
                  oprestePolling();
                  
                  // Revino la selecție
                  welcomeSection.style.display = 'none';
                  selectionSection.style.display = 'block';
                  queueSection.style.display = 'none';
                  populeazaSpecializari();
                  
                  // Afișează mesaj de confirmare
                  setTimeout(() => {
                    alert('Ai revenit la selecția medicului.');
                  }, 100);
                } catch (err) {
                  console.error('Eroare la anularea cozii:', err);
                  // Chiar dacă apare o eroare, revino la selecție
                  sessionStorage.removeItem('scanare_cod_medic_id');
                  sessionStorage.removeItem('scanare_cod_specializare');
                  sessionStorage.removeItem('scanare_cod_state');
                  welcomeSection.style.display = 'none';
                  selectionSection.style.display = 'block';
                  queueSection.style.display = 'none';
                  populeazaSpecializari();
                  alert('Ai revenit la selecția medicului.');
                }
              }
              if (e.target && e.target.id === 'btn-programeaza-altadata') {
                // Curăță sessionStorage înainte de a merge la pagina de programări
                sessionStorage.removeItem('scanare_cod_medic_id');
                sessionStorage.removeItem('scanare_cod_specializare');
                sessionStorage.removeItem('scanare_cod_state');
                
                // Curăță și statusurile specifice medicilor
                Object.keys(sessionStorage).forEach(key => {
                  if (key.startsWith('scanare_cod_state_')) {
                    sessionStorage.removeItem(key);
                  }
                });
                
                // Oprește polling-ul
                oprestePolling();
                
                // Redirecționează la pagina de programări
                window.location.href = '/html/pacient.html';
              }
            });
            
            // Fix dropdown: rămâne deschis până când utilizatorul apasă din nou sau în afara lui
            if (!dropdown._outsideClickListener) {
              dropdown._outsideClickListener = (event) => {
                if (!dropdown.contains(event.target) && event.target !== btn) {
                  dropdown.style.display = 'none';
                  dropdownDeschis = false;
                  document.removeEventListener('mousedown', dropdown._outsideClickListener);
                  dropdown._outsideClickListener = null;
                }
              };
            }
            
            if (dropdown.style.display === 'flex') {
              setTimeout(() => {
                document.addEventListener('mousedown', dropdown._outsideClickListener);
              }, 0);
            }
          };
        }
        function clickOutsideDropdown(event) {
          if (!dropdown.contains(event.target) && event.target !== btn) {
            dropdown.style.display = 'none';
            dropdownDeschis = false;
            document.removeEventListener('mousedown', clickOutsideDropdown, true);
          }
        }
      }, 100);
    } catch (err) {
      console.error('Eroare la afișarea opțiunilor cozii:', err);
      afiseazaEroareVizibila('Nu s-au putut afișa opțiunile cozii.');
    }
  }

  // Funcție pentru a pune la coadă
  window.puneLaCoada = async function(idMedic) {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    const userId = sessionStorage.getItem('userId');
    if (isLoggedIn && userId) {
      // Oprește orice polling global de coadă
      if (typeof intervalCoada !== 'undefined' && intervalCoada) clearInterval(intervalCoada);
      try {
        // Folosește data locală pentru a evita probleme cu timezone-ul
        const now = new Date();
        const azi = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const res = await fetch(`/api/coada/${idMedic}/adauga`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_pacient: userId, data: azi })
        });
        const data = await res.json();
        // Nu mai afișăm alert-ul redundant, direct afișăm statusul cozii
        await afiseazaStatusPersonalCoada(idMedic, userId, true);
      } catch (err) {
        console.error('Eroare la adăugarea la coadă:', err);
        alert('A apărut o eroare la adăugarea la coadă.');
      }
    } else {
      // fallback pentru utilizator neautentificat (nu ar trebui să ajungă aici)
      const nume = prompt('Introduceți numele pentru a vă pune la coadă:');
      if (!nume) return;
      try {
        const res = await fetch(`/api/coada/${idMedic}/adauga`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nume: nume })
        });
        const data = await res.json();
        // Pentru utilizatorii neautentificați, afișăm mesajul de confirmare
        alert(data.message || 'Adăugat la coadă!');
      } catch (err) {
        console.error('Eroare la adăugarea la coadă:', err);
        alert('A apărut o eroare la adăugarea la coadă.');
      }
    }
  };

  // Funcții helper pentru afișarea mesajelor
  function afiseazaMesajFinalizare(medicNume, specializare, oraStart, oraSfarsit) {
    const statusClass = 'liber';
    const icon = '<i class="fas fa-check-circle icon" style="color:#27ae60;font-size:2em;vertical-align:middle;"></i>';
    let detaliiOra = '';
    if (oraStart && oraSfarsit) {
      detaliiOra = `<div style='margin:8px 0;'><b>Ora consultației:</b> ${oraStart} - ${oraSfarsit}</div>`;
    }
    
    const mesaj = `
      <div style='display:flex;align-items:center;gap:12px;margin-bottom:8px;'>
        ${icon}
        <span style='font-size:1.25em;font-weight:600;color:#27ae60;'>Consultația a fost finalizată</span>
      </div>
      <div style='margin-bottom:10px;color:#2c3e50;font-size:1.08em;'>
        Mulțumim că ai ales serviciile noastre! Consultația ta s-a încheiat cu succes.
      </div>
      ${detaliiOra}
      <div style='margin:18px 0 10px 0;padding:14px 18px;background:#f4f8f4;border-radius:10px;border-left:5px solid #27ae60;'>
        <span style='display:block;font-weight:500;color:#1a7f1a;margin-bottom:6px;'>Sugestie: Poți consulta fișa ta medicală și istoricul consultațiilor în pagina personală.</span>
        <span style='color:#444;'>Accesează fișa medicală pentru detalii suplimentare.</span>
      </div>
      <a href='/html/pacient.html?fromConsultation=true' class='btn btn-primary' id='btn-fisa-medicala' style='margin-top:10px;text-decoration:none;padding:12px 28px;border-radius:8px;background:linear-gradient(90deg,#27ae60,#1a7f1a);color:white;font-weight:600;font-size:1.1em;box-shadow:0 2px 8px rgba(39,174,96,0.08);transition:background 0.2s;'>
        <i class="fas fa-notes-medical" style="margin-right:8px;"></i> Accesează fișa medicală
      </a>
    `;
    
    afiseazaMesaj(statusClass, mesaj);
    // Curăță sessionStorage și revino la selecție la refresh sau după click pe buton
    setTimeout(() => {
      sessionStorage.removeItem('scanare_cod_medic_id');
      sessionStorage.removeItem('scanare_cod_specializare');
      sessionStorage.removeItem('scanare_cod_state');
      // și statusurile specifice medicilor
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('scanare_cod_state_')) {
          sessionStorage.removeItem(key);
        }
      });
    }, 500);
  }

  function afiseazaMesajAsteptat(medicNume, specializare, numeMedic, oraInceput) {
    const statusClass = 'liber';
    const icon = '<i class="fas fa-door-open icon"></i>';
    let detalii = '';
    if (numeMedic) {
      detalii += `<div style='margin-top:8px;font-size:1.1em;'><b>Medic:</b> ${numeMedic}</div>`;
    }
    if (oraInceput) {
      detalii += `<div style='font-size:1.1em;'><b>Ora de început:</b> ${oraInceput}</div>`;
    }
    
    const mesaj = `${icon} <span style='font-size:1.2em;color:#1a7f1a;font-weight:600;'>Sunteți așteptat(ă) în cabinet!</span>${detalii}`;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajUrmator(medicNume, specializare, timpEstimare) {
    const statusClass = 'urmator';
    const icon = '<i class="fas fa-user-check icon"></i>';
    const mesaj = `
      <div style='background:#e8f5e9;border:2px solid #66bb6a;border-radius:12px;padding:18px 20px;margin:10px 0 18px 0;box-shadow:0 2px 8px rgba(102,187,106,0.10);'>
        <div style='font-size:1.18em;font-weight:600;margin-bottom:6px;'>Ești la coadă la <span style='color:#007bff;'>Dr. ${medicNume}</span> <span style='color:#888;font-size:0.95em;'>(${specializare})</span></div>
        <b style='font-size:1.25em;'>Ești următorul la rând!</b><br>
        <span style='color:#1a7f1a;font-weight:500;'>Te rugăm să aștepți confirmarea medicului pentru a intra în cabinet.</span>
        <div style='margin-top:8px;'><b>Timp estimat de așteptare:</b> <span style='color:#388e3c;font-size:1.1em;font-weight:600;'>${timpEstimare} minute</span></div>
      </div>
    `;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajUrmatorCuAsteptare(medicNume, specializare, timpEstimare) {
    const statusClass = 'ok';
    const icon = '<i class="fas fa-user-check icon"></i>';
    const mesaj = `<b>Ești următorul la rând!</b><br>Timp estimat de așteptare: <b>${timpEstimare} minute</b>.`;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajInCoada(medicNume, specializare, persoaneInFata, timpEstimare) {
    const statusClass = 'ok';
    const icon = '<i class="fas fa-user-clock icon"></i>';
    
    let persoaneText = '';
    if (persoaneInFata === 0) {
      persoaneText = '<span style="color:#27ae60;font-size:1.1em;font-weight:600;">Ești primul în coadă!</span>';
    } else if (persoaneInFata === 1) {
      persoaneText = '<span style="color:#d35400;font-size:1.1em;font-weight:600;">1 persoană</span>';
    } else {
      persoaneText = `<span style='color:#d35400;font-size:1.1em;font-weight:600;'>${persoaneInFata} persoane</span>`;
    }
    
    const mesaj = `
      <div style='background:#fffbe6;border:2px solid #ffd54f;border-radius:12px;padding:18px 20px;margin:10px 0 18px 0;box-shadow:0 2px 8px rgba(255,213,79,0.10);'>
        <div style='font-size:1.18em;font-weight:600;margin-bottom:6px;'>Ești la coadă la <span style='color:#007bff;'>Dr. ${medicNume}</span> <span style='color:#888;font-size:0.95em;'>(${specializare})</span></div>
        <div style='margin:8px 0;'><b>Persoane în față:</b> ${persoaneText}</div>
        <div style='margin:8px 0;'><b>Timp estimat de așteptare:</b> <span style='color:#d35400;font-size:1.1em;font-weight:600;'>${Math.max(0, Math.round(timpEstimare || 0))} min</span></div>
      </div>
    `;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajInCoadaFaraAsteptare(medicNume, specializare, timpEstimare) {
    const statusClass = 'ok';
    const icon = '<i class="fas fa-user icon"></i>';
    const mesaj = `Ați anunțat că ați ajuns. Vă rugăm să așteptați confirmarea medicului pentru a intra în cabinet.<br>Timp estimat de așteptare: <b>${timpEstimare} minute</b>.`;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajNuInCoada(medicNume, specializare) {
    const statusClass = 'avertizare';
    const icon = '<i class="fas fa-exclamation-triangle icon"></i>';
    const mesaj = `Nu ești înregistrat(ă) la coadă la Dr. ${medicNume} (${specializare}).`;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesajEroare() {
    const statusClass = 'avertizare';
    const icon = '<i class="fas fa-exclamation-triangle icon"></i>';
    const mesaj = `A apărut o eroare la încărcarea situației cozii. Te rugăm să încerci din nou.`;
    afiseazaMesaj(statusClass, mesaj);
  }

  function afiseazaMesaj(statusClass, mesaj) {
    infoCoada.className = 'info-coada ' + statusClass;
    infoCoada.innerHTML = mesaj;
    optiuniUtilizator.innerHTML = '';
    selectionSection.style.display = 'none';
    queueSection.style.display = 'block';
  }

  function pornestePolling(idMedic, idPacient) {
    if (intervalStatusPersonal) clearInterval(intervalStatusPersonal);
    intervalStatusPersonal = setInterval(() => {
      window.afiseazaStatusPersonalCoada(idMedic, idPacient, false);
    }, 4000); // verifică la fiecare 4 secunde
  }

  function oprestePolling() {
    if (intervalStatusPersonal) {
      clearInterval(intervalStatusPersonal);
      intervalStatusPersonal = null;
    }
  }

  // La login sau selectare medic, verifică dacă utilizatorul este deja în coadă la acel medic și afișează statusul corect
  async function verificaStatusDupaLoginSauSelectie(idMedic, userId) {
    try {
      const azi = new Date().toISOString().split('T')[0];
              const res = await fetch(`/api/coada/status_pacient/${userId}/${idMedic}/${azi}`);
      if (res.status === 404) {
        // Nu ești în coadă, comportament normal: returnează false
        return false;
      }
      if (!res.ok) {
        // Alte erori
        throw new Error('Eroare la verificarea statusului cozii');
      }
      const data = await res.json();
      // Dacă ești în coadă, returnează true
      return true;
    } catch (err) {
      // Loghează doar alte erori, nu 404
      if (err.message !== 'Eroare la verificarea statusului cozii') {
        console.error('Eroare la verificaStatusDupaLoginSauSelectie:', err);
      }
      return false;
    }
  }

  // PATCH: Helper pentru afisare erori vizibile
  function afiseazaEroareVizibila(msg) {
    infoCoada.className = 'info-coada error';
    infoCoada.innerHTML = `<div style='color:red;font-weight:600;padding:12px;'>${msg}</div>`;
  }

  // Adaugă funcția helper pentru mesajul de consultație
  function afiseazaMesajInConsultatie(medicNume, specializare) {
    const statusClass = 'in-consultatie';
    const icon = '<i class="fas fa-door-open icon" style="color:#1976d2;font-size:2em;vertical-align:middle;"></i>';
    const mesaj = `
      <div style='display:flex;align-items:center;gap:12px;margin-bottom:8px;'>
        ${icon}
        <span style='font-size:1.25em;font-weight:600;color:#1976d2;'>Ești așteptat(ă) în cabinet!</span>
      </div>
      <div style='margin-bottom:10px;color:#2c3e50;font-size:1.08em;'>Te rugăm să intri în cabinet pentru consultație.</div>
    `;
    afiseazaMesaj(statusClass, mesaj);
  }
});