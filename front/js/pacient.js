// ✅ pacient.js rescris complet, funcțional, fără erori

document.addEventListener("DOMContentLoaded", async () => {
  // --- Autentificare și inițializare ---
  const userId = sessionStorage.getItem("userId");
  const isLoggedIn = sessionStorage.getItem("isLoggedIn") === "true";
  if (!isLoggedIn || !userId) {
    window.location.href = "/html/login.html";
    return;
  }
  localStorage.setItem('id_pacient', userId);

  // --- Dropdown meniu pacient ---
  const userIcon = document.getElementById("user-icon");
  const dropdown = document.getElementById("dropdownPacient");
  if (userIcon && dropdown) {
    userIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
    });
    document.addEventListener("mousedown", function(event) {
      if (dropdown.style.display === 'flex' && !dropdown.contains(event.target) && event.target !== userIcon) {
        dropdown.style.display = 'none';
      }
    });
  }

  // --- Butoane scroll secțiuni ---
  document.getElementById("btn-istoric")?.addEventListener("click", () => {
    document.getElementById("sectiune-istoric").scrollIntoView({ behavior: 'smooth' });
    dropdown.style.display = 'none';
  });
  document.getElementById("btn-fisa")?.addEventListener("click", () => {
    document.getElementById("sectiune-fisa").scrollIntoView({ behavior: 'smooth' });
    dropdown.style.display = 'none';
  });

  // --- Populare specializări ---
  const specializareSelect = document.getElementById("specializare-stoma");
  const dataInput = document.getElementById("data-stoma");
  const oraSelect = document.getElementById("ora-stoma");
  const medicSelect = document.getElementById("medic-stoma");
  const today = new Date().toISOString().split('T')[0];
  dataInput.setAttribute("min", today);
  try {
    const res = await fetch("/api/specializari");
    const specializari = await res.json();
    specializari.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      specializareSelect.appendChild(opt);
    });
  } catch (err) { console.error("Eroare la încărcarea specializărilor:", err); }

  // --- Populare date pacient în navbar ---
  try {
    const res = await fetch(`/api/pacient/${userId}`);
    const pacient = await res.json();
    if (pacient && pacient.nume && pacient.prenume) {
      const fullName = `${pacient.prenume} ${pacient.nume}`;
      document.getElementById("nume-navbar").innerText = fullName;
      document.getElementById("nume-pacient").innerText = fullName;
    }
  } catch (err) { console.error("Eroare la încărcarea datelor pacientului:", err); }

  // --- Programări: încărcare, adăugare, ștergere ---
  await incarcaProgramari();
  document.getElementById("formular-programare-stoma").addEventListener("submit", async (e) => {
    e.preventDefault();
    const specializare = specializareSelect.value;
    const id_medic = medicSelect.value;
    const data = dataInput.value;
    const ora = oraSelect.value;
    if (!specializare || !id_medic || !data || !ora) {
      alert("Te rog completează toate câmpurile obligatorii.");
      return;
    }
    if (data < today) {
      alert("Nu poți selecta o dată anterioară zilei curente.");
      return;
    }
    if (!oraEsteValida(ora)) {
      alert("Ora trebuie să fie între 07:00 și 20:30, la fix sau jumătate.");
      return;
    }
    try {
      const verificareRes = await fetch(`/api/medici/verifica-disponibilitate?medic=${id_medic}&data=${data}&ora=${ora}`);
      if (!verificareRes.ok) {
        alert("Medicul nu mai este disponibil la această oră. Te rog selectează o altă oră.");
        return;
      }
      const res = await fetch("/api/programari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_pacient: userId, id_medic, data, ora })
      });
      if (res.ok) {
        alert("Programarea a fost adăugată cu succes!");
        await incarcaProgramari();
      } else {
        alert("Eroare la adăugarea programării.");
      }
    } catch (err) { alert("Eroare la adăugarea programării."); }
  });

  // --- Populare medici și ore disponibile ---
  specializareSelect.addEventListener("change", incarcaMediciDisponibili);
  medicSelect.addEventListener("change", populeazaOreDisponibile);
  dataInput.addEventListener("change", () => {
    if (medicSelect.value) populeazaOreDisponibile();
    else oraSelect.innerHTML = '<option value="">-- Selectează mai întâi medicul --</option>';
  });

  async function incarcaMediciDisponibili() {
    const specializare = specializareSelect.value;
    medicSelect.innerHTML = '<option value="">-- Se încarcă medicii --</option>';
    oraSelect.innerHTML = '<option value="">-- Selectează mai întâi medicul --</option>';
    if (!specializare) {
      medicSelect.innerHTML = '<option value="">-- Selectează specializarea --</option>';
      return;
    }
    try {
      const res = await fetch(`/api/medici/specializare?specializare=${encodeURIComponent(specializare)}`);
      const lista = await res.json();
      medicSelect.innerHTML = '<option value="">-- Selectează medicul --</option>';
      if (lista.length === 0) {
        medicSelect.innerHTML = '<option value="">Nu există medici pentru această specializare</option>';
      } else {
        lista.forEach(medic => {
          const opt = document.createElement("option");
          opt.value = medic.id_medic;
          opt.textContent = `${medic.nume} – Rating: ${Number(medic.rating).toFixed(2)}/5`;
          medicSelect.appendChild(opt);
        });
      }
    } catch (err) {
      medicSelect.innerHTML = '<option value="">Eroare la încărcarea medicilor</option>';
    }
  }
  async function populeazaOreDisponibile() {
    const medicId = medicSelect.value;
    const data = dataInput.value;
    oraSelect.innerHTML = '<option value="">-- Se încarcă orele disponibile --</option>';
    if (!medicId || !data) {
      oraSelect.innerHTML = '<option value="">-- Selectează medicul și data --</option>';
      return;
    }
    try {
      const res = await fetch(`/api/medici/ore-disponibile?medic=${medicId}&data=${data}`);
      if (res.ok) {
        const oreDisponibile = await res.json();
        oraSelect.innerHTML = '<option value="">-- Selectează ora --</option>';
        if (oreDisponibile.length === 0) {
          oraSelect.innerHTML = '<option value="">Nu sunt ore disponibile pentru această zi</option>';
        } else {
          oreDisponibile.forEach(ora => {
            const opt = document.createElement("option");
            opt.value = ora;
            opt.textContent = ora;
            oraSelect.appendChild(opt);
          });
        }
      } else {
        oraSelect.innerHTML = '<option value="">Eroare la încărcarea orelor disponibile</option>';
      }
    } catch (err) {
      oraSelect.innerHTML = '<option value="">Eroare la încărcarea orelor disponibile</option>';
    }
  }
  function oraEsteValida(ora) {
    if (!ora) return false;
    const [h, m] = ora.split(":");
    const hour = parseInt(h, 10);
    const minute = parseInt(m, 10);
    return (
      (hour > 7 || (hour === 7 && (minute === 0 || minute === 30))) &&
      (hour < 20 || (hour === 20 && (minute === 0 || minute === 30))) &&
      (minute === 0 || minute === 30)
    );
  }

  // --- Programări: încărcare și ștergere ---
  async function incarcaProgramari() {
    try {
      const res = await fetch(`/api/programari/${userId}`);
      const programari = await res.json();
      afiseazaIstoricProgramari(programari);
    } catch (err) {
      afiseazaIstoricGol();
    }
  }
  function afiseazaIstoricGol() {
    document.getElementById("lista-programari").innerHTML = `<p style="color: gray;">Nu există programări înregistrate.</p>`;
  }
  function afiseazaIstoricProgramari(lista) {
    // Nu mai filtrăm programările anulate sau cele vechi
    const container = document.getElementById('lista-programari');
    if (lista.length === 0) { afiseazaIstoricGol(); return; }
    let html = '<ul class="istoric-list">';
    lista.forEach(p => {
      const status = p.status === "finalizat" ? "✔ Finalizat" :
                     p.status === "neprezentat" ? "❌ Neprezentat" :
                     p.status === "anulata" ? "Anulată" :
                     "În așteptare";
      const deleteButton = p.status !== "finalizat" ? 
        `<button class="delete-btn" data-id="${p.id_programare}" title="Șterge programarea">
          <i class="fas fa-trash"></i>
        </button>` : '';
      html += `
        <li class="programare-item">
          <div class="programare-info">
            <strong>${p.data}</strong> – ${p.specializare} – ${p.medic} – 
            <span class="status ${p.status}">${status}</span>
          </div>
          ${deleteButton}
        </li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (confirm('Sigur doriți să ștergeți această programare?')) {
          const programareId = e.currentTarget.getAttribute('data-id');
          try {
            const response = await fetch(`/api/programari/${programareId}`, { method: 'DELETE' });
            const result = await response.json();
            if (response.ok) {
              alert('Programarea a fost ștearsă cu succes!');
              await incarcaProgramari();
            } else {
              throw new Error(result.message || 'Eroare la ștergerea programării');
            }
          } catch (error) {
            alert(`A apărut o eroare la ștergerea programării: ${error.message}`);
          }
        }
      });
    });
  }

  // --- Fișa medicală ---
  await afiseazaFisaPacient();
  async function afiseazaFisaPacient() {
    try {
      const response = await fetch(`/api/fisa-medicala/${userId}`);
      if (response.ok) {
        const fisa = await response.json();
        const dataNasterii = fisa.pacient.data_nasterii ? new Date(fisa.pacient.data_nasterii).toLocaleDateString('ro-RO') : 'Nespecificat';
        
        let html = `
      <h2>Fișa medicală</h2>
          <button class="btn-vezi-detalii" onclick="afiseazaDetaliiFisa()">Vezi detalii</button>
          <div id="detalii-fisa" class="fisa-content" style="display: none;">
            <div class="fisa-section">
              <h3>Informații generale pacient</h3>
              <p><strong>Nume complet:</strong> ${fisa.pacient.nume_complet}</p>
              <p><strong>Data nașterii:</strong> ${dataNasterii}</p>
              <p><strong>Vârstă:</strong> ${fisa.pacient.varsta} ani</p>
              <p><strong>Email:</strong> ${fisa.pacient.email}</p>
              <p><strong>Telefon:</strong> ${fisa.pacient.telefon || 'Nespecificat'}</p>
            </div>`;
        
        if (fisa.istoric_consultatii && fisa.istoric_consultatii.length > 0) {
          html += `<div class="fisa-section"><h3>Istoric consultații (${fisa.istoric_consultatii.length} consultații)</h3><div class="consultatii-list">`;
          fisa.istoric_consultatii.forEach((consultatie, index) => {
            const dataFormatata = new Date(consultatie.data).toLocaleDateString('ro-RO');
            html += `<div class="consultatie-item"><div class="consultatie-header"><h4>Consultația #${index + 1} - ${dataFormatata}</h4></div><div class="consultatie-details"><p><strong>Medic:</strong> ${consultatie.nume_medic} (${consultatie.specializare})</p><p><strong>Ora:</strong> ${consultatie.ora_start} - ${consultatie.ora_sfarsit} (${consultatie.durata || 'N/A'} min)</p><p><strong>Diagnostic:</strong> ${consultatie.diagnostic || 'Nespecificat'}</p><p><strong>Tratament:</strong> ${consultatie.tratament || 'Nespecificat'}</p><p><strong>Cost:</strong> ${consultatie.cost || 'N/A'} RON</p></div></div>`;
          });
          html += `</div></div>`;
          
          // Calculează statistici din istoricul consultațiilor
          const numarConsultatii = fisa.istoric_consultatii.length;
          const costTotal = fisa.istoric_consultatii.reduce((sum, c) => sum + (c.cost || 0), 0);
          const durataTotala = fisa.istoric_consultatii.reduce((sum, c) => sum + (c.durata || 0), 0);
          const durataMedie = numarConsultatii > 0 ? Math.round(durataTotala / numarConsultatii) : 0;
          const primaConsultatie = fisa.istoric_consultatii[fisa.istoric_consultatii.length - 1]?.data ? new Date(fisa.istoric_consultatii[fisa.istoric_consultatii.length - 1].data).toLocaleDateString('ro-RO') : 'N/A';
          const ultimaConsultatie = fisa.istoric_consultatii[0]?.data ? new Date(fisa.istoric_consultatii[0].data).toLocaleDateString('ro-RO') : 'N/A';
          
          html += `<div class="fisa-section"><h3>Statistici</h3><p><strong>Număr total consultații:</strong> ${numarConsultatii}</p><p><strong>Cost total:</strong> ${costTotal} RON</p><p><strong>Durata medie consultație:</strong> ${durataMedie} minute</p><p><strong>Prima consultație:</strong> ${primaConsultatie}</p><p><strong>Ultima consultație:</strong> ${ultimaConsultatie}</p></div>`;
        } else {
          html += `<div class="fisa-section"><h3>Istoric consultații</h3><p>Nu există consultații înregistrate încă.</p></div>`;
        }
        
        html += `</div>`;
        document.getElementById("sectiune-fisa").innerHTML = html;
      } else {
        afiseazaMesajFisaInexistenta();
      }
    } catch (error) {
      console.error('Eroare la încărcarea fișei medicale:', error);
      afiseazaMesajFisaInexistenta();
    }
  }
  function afiseazaMesajFisaInexistenta() {
    document.getElementById("sectiune-fisa").innerHTML = `<h2>Fișa medicală</h2><p style="color: gray;">Pacientul nu are o fișă medicală creată momentan.</p>`;
  }
  window.afiseazaDetaliiFisa = function() {
    const detaliiDiv = document.getElementById('detalii-fisa');
    const btn = document.querySelector('.btn-vezi-detalii');
    if (detaliiDiv.style.display === 'none') {
      detaliiDiv.style.display = 'block';
      btn.textContent = 'Ascunde detalii';
    } else {
      detaliiDiv.style.display = 'none';
      btn.textContent = 'Vezi detalii';
    }
  };

  // --- FEEDBACK ---
  await incarcaMediciFeedback();
  async function getMediciCuFeedback(id_pacient) {
    const res = await fetch(`/api/feedback?id_pacient=${id_pacient}`);
    const data = await res.json();
    return data.consultatii_feedback || [];
  }
  async function incarcaMediciFeedback() {
    const id_pacient = sessionStorage.getItem('userId');
    const mediciFeedback = await getMediciCuFeedback(id_pacient);
    // Obține toți medicii la care pacientul are programări finalizate
    const res = await fetch(`/api/consultatii-finalizate/${id_pacient}`);
    const consultatii = await res.json();
    // Extrage medicii unici la care nu s-a dat feedback
    const mediciUnici = [];
    const mediciAdaugati = new Set();
    consultatii.forEach(c => {
      if (!mediciFeedback.includes(c.id_medic) && !mediciAdaugati.has(c.id_medic)) {
        mediciUnici.push({ id: c.id_medic, nume: c.nume_medic, specializare: c.specializare });
        mediciAdaugati.add(c.id_medic);
      }
    });
    const medicSelect = document.getElementById('feedback-id-medic');
    medicSelect.innerHTML = '<option value="">Alege medicul</option>';
    if (mediciUnici.length === 0) {
      medicSelect.innerHTML = '<option value="">Nu există medici eligibili pentru feedback</option>';
      medicSelect.disabled = true;
      document.querySelector('#feedback-form button[type="submit"]').disabled = true;
    } else {
      medicSelect.disabled = false;
      document.querySelector('#feedback-form button[type="submit"]').disabled = false;
      mediciUnici.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.nume} (${m.specializare})`;
        medicSelect.appendChild(opt);
      });
    }
  }
  // --- Feedback submit ---
  const feedbackForm = document.getElementById('feedback-form');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      let msgDiv = document.getElementById('feedback-msg');
      if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.id = 'feedback-msg';
        feedbackForm.parentNode.insertBefore(msgDiv, feedbackForm.nextSibling);
      }
      const id_pacient = sessionStorage.getItem('userId');
      const id_medic = document.getElementById('feedback-id-medic').value;
      const scor = document.querySelector('input[name="rating-medic"]:checked')?.value;
      let comentariu = document.getElementById('feedback-comment-medic').value;
      if (!id_medic || !scor) {
        msgDiv.textContent = 'Selectați medicul și ratingul!';
        return;
      }
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_pacient, id_medic, scor, comentariu, tip: 'medic' })
        });
        if (res.status === 201) {
          msgDiv.textContent = 'Feedback trimis cu succes!';
          feedbackForm.reset();
          await incarcaMediciFeedback();
        } else if (res.status === 409) {
          msgDiv.textContent = 'Ați trimis deja feedback acestui medic!';
        } else {
          msgDiv.textContent = 'Eroare la trimiterea feedback-ului!';
        }
      } catch (err) {
        msgDiv.textContent = 'Eroare la trimiterea feedback-ului!';
      }
    });
  }

  // --- SCHIMBARE PAROLĂ ---
  const btnSchimbaParola = document.getElementById('btn-schimba-parola');
  const modalSchimbaParola = document.getElementById('modal-schimba-parola');
  const closeModalSchimbaParola = document.getElementById('close-modal-schimba-parola');
  const formSchimbaParola = document.getElementById('form-schimba-parola');
  const parolaNouaInput = document.getElementById('parola-noua');
  const parolaConfirmareInput = document.getElementById('parola-confirmare');
  const parolaEroareDiv = document.getElementById('parola-eroare');

  if (btnSchimbaParola && modalSchimbaParola && closeModalSchimbaParola && formSchimbaParola) {
    btnSchimbaParola.onclick = () => {
      modalSchimbaParola.style.display = 'block';
      parolaNouaInput.focus();
      parolaEroareDiv.textContent = '';
      formSchimbaParola.reset();
      dropdown.style.display = 'none';
    };
    closeModalSchimbaParola.onclick = () => { modalSchimbaParola.style.display = 'none'; parolaEroareDiv.textContent = ''; formSchimbaParola.reset(); };
    window.onclick = function(event) {
      if (event.target === modalSchimbaParola) {
        modalSchimbaParola.style.display = 'none'; parolaEroareDiv.textContent = ''; formSchimbaParola.reset();
      }
    };
    formSchimbaParola.onsubmit = async function(e) {
      e.preventDefault();
      const parolaNoua = parolaNouaInput.value;
      const parolaConfirmare = parolaConfirmareInput.value;
      parolaEroareDiv.style.color = 'red';
      parolaEroareDiv.textContent = '';
      if (parolaNoua.length < 6) {
        parolaEroareDiv.textContent = 'Parola trebuie să aibă minim 6 caractere.';
        parolaNouaInput.focus();
        return;
      }
      if (parolaNoua !== parolaConfirmare) {
        parolaEroareDiv.textContent = 'Parolele nu coincid!';
        parolaConfirmareInput.focus();
        return;
      }
      try {
        const res = await fetch(`/api/pacienti/${userId}/schimba-parola`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parola: parolaNoua })
        });
        if (res.ok) {
          parolaEroareDiv.style.color = 'green';
          parolaEroareDiv.textContent = 'Parola a fost schimbată cu succes!';
          setTimeout(() => { modalSchimbaParola.style.display = 'none'; parolaEroareDiv.textContent = ''; formSchimbaParola.reset(); }, 1500);
        } else {
          parolaEroareDiv.textContent = 'Eroare la schimbarea parolei!';
        }
      } catch (e) {
        parolaEroareDiv.textContent = 'Eroare la schimbarea parolei!';
      }
    };
  }

  // --- DELOGARE CORECTĂ ---
  const btnLogout = document.querySelector('#dropdownPacient button[onclick*="home.html"]');
  if (btnLogout) {
    btnLogout.addEventListener('click', function(e) {
      e.preventDefault();
      sessionStorage.clear();
      localStorage.clear();
      window.location.href = 'home.html';
    });
  }
});
// ... END pacient.js ...
