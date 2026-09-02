// --- VARIABILE GLOBALE ---
let medicId = null;
let refreshInterval = null;
let statsChart = null;
let socket;

// --- UTILS ---
function getStatusBadge(status) {
    switch (status) {
        case 'finalizat':
            return '<span class="status-badge status-finalizat"><i class="fas fa-check-circle"></i> Finalizat</span>';
        case 'neprezentat':
            return '<span class="status-badge status-neprezentat"><i class="fas fa-user-slash"></i> Neprezentat</span>';
        case 'anulata':
            return '<span class="status-badge status-anulata"><i class="fas fa-times-circle"></i> Anulată</span>';
        default:
            return '<span class="status-badge status-programata"><i class="fas fa-calendar-check"></i> Programată</span>';
    }
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('ro-RO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// --- DASHBOARD INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    // Verifică autentificarea
    medicId = sessionStorage.getItem('userId');
    if (!medicId) {
        window.location.href = 'login.html';
        return;
    }
    // Nume medic în navbar
    try {
        const res = await fetch(`/api/medic/${medicId}`);
        if (res.ok) {
            const medic = await res.json();
            document.getElementById('medic-name').textContent = `Dr. ${medic.nume}`;
            document.getElementById('medic-specializare').textContent = medic.specializare || '-';
        }
    } catch {}
    // Inițializări
    await loadQueue();
    await loadAppointmentsToday();
    await loadAcceptedPatients();
    await loadAllAppointments();
    startAutoRefresh();
    // Ascunde secțiunea programări la încărcare
    document.getElementById('all-appointments-section').style.display = 'none';
    // Buton logout
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.clear();
            window.location.href = 'login.html';
        });
    }
    // --- REPARARE MENIU DE NAVIGARE ---
    function showSection(sectionId) {
        document.querySelectorAll('.dashboard > section').forEach(sec => sec.style.display = 'none');
        const section = document.getElementById(sectionId);
        if (section) section.style.display = '';
    }
    // Home/dashboard
    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) {
        homeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.dashboard > section').forEach(sec => sec.style.display = '');
            document.getElementById('all-appointments-section').style.display = 'none';
        });
    }
    // Programări
    const navLinks = document.querySelectorAll('.nav-links .nav-link');
    const programariBtn = Array.from(navLinks).find(a => a.textContent.includes('Programări'));
    if (programariBtn) {
        programariBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            showSection('all-appointments-section');
            await loadAllAppointments();
        });
    }
    // Pacienți
    const pacientiBtn = Array.from(navLinks).find(a => a.textContent.includes('Pacienți'));
    if (pacientiBtn) {
        pacientiBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            showSection('patients-section');
            await loadConsultedPatients();
        });
    }
    // Statistici
    const statsBtn = document.getElementById('stats-btn');
    console.log('statsBtn:', statsBtn);
    if (statsBtn) {
        statsBtn.addEventListener('click', async (e) => {
            console.log('Click pe butonul Statistici!');
            e.preventDefault();
            showSection('stats-section');
            await loadMedicStats();
        });
    }
    // Profil
    const profileBtn = document.getElementById('profile-btn');
    if (profileBtn) {
        profileBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            showSection('profile-section');
            await loadMedicProfile();
        });
    }
    // Upload poză profil real
    const profilePic = document.getElementById('profile-pic');
    const profileUpload = document.getElementById('profile-upload');
    if (profilePic && profileUpload) {
        profilePic.addEventListener('click', () => profileUpload.click());
        profileUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const formData = new FormData();
                formData.append('poza', file);
                try {
                    const res = await fetch(`/api/medic/${medicId}/upload-poza`, {
                        method: 'POST',
                        body: formData
                    });
                    if (res.ok) {
                        const data = await res.json();
                        profilePic.src = data.path + '?t=' + Date.now(); // force refresh
                    } else {
                        alert('Eroare la upload poză');
                    }
                } catch {
                    alert('Eroare la upload poză');
                }
            }
        });
    }
    // Evidențiere formular la selectare pacient
    const patientSelect = document.getElementById('patient-select');
    if (patientSelect) {
        patientSelect.addEventListener('change', function() {
            const consultationSection = document.querySelector('.consultation-section');
            if (this.value) {
                consultationSection.classList.add('patient-selected');
            } else {
                consultationSection.classList.remove('patient-selected');
            }
        });
    }
    // Submit consultație
    const consultationForm = document.getElementById('consultation-form');
    if (consultationForm) {
        consultationForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            const patientId = document.getElementById('patient-select').value;
            const startTime = document.getElementById('start-time').value;
            const endTime = document.getElementById('end-time').value;
            const diagnostic = document.getElementById('diagnostic').value;
            const treatment = document.getElementById('treatment').value;
            const cost = document.getElementById('cost').value;
            if (!patientId) {
                alert('Selectează un pacient!');
                return;
            }
            try {
                const response = await fetch('/api/consultatii', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_medic: medicId,
                        id_pacient: patientId,
                        data: new Date().toISOString().split('T')[0],
                        ora_start: startTime,
                        ora_sfarsit: endTime,
                        diagnostic: diagnostic,
                        tratament: treatment,
                        cost: parseFloat(cost)
                    })
                });
                if (response.ok) {
                    alert('Consultația a fost salvată cu succes!');
                    this.reset();
                    await loadQueue();
                    await loadAppointmentsToday();
                    await loadAcceptedPatients();
                } else {
                    const error = await response.json();
                    alert(`Eroare: ${error.message}`);
                }
            } catch (error) {
                alert('Eroare la salvarea consultației');
            }
        });
    }
    // --- SOCKET.IO pentru actualizare programari in timp real ---
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
        script.onload = () => {
            socket = io();
            socket.emit('join-medic-room', medicId);
            socket.on('programare-noua', (data) => {
                if (data && data.id_medic == medicId) {
                    loadAppointmentsToday();
                    loadAllAppointments();
                }
            });
        };
        document.head.appendChild(script);
    } else {
        socket = io();
        socket.emit('join-medic-room', medicId);
        socket.on('programare-noua', (data) => {
            if (data && data.id_medic == medicId) {
                loadAppointmentsToday();
                loadAllAppointments();
            }
        });
    }
});

// --- COADA DE AȘTEPTARE ---
async function loadQueue() {
    const azi = new Date().toISOString().split('T')[0];
    try {
        const res = await fetch(`/api/coada_efectiva/${medicId}/${azi}`);
        if (res.ok) {
            const data = await res.json();
            const queue = data.coada || [];
            const durataMedie = data.durata_medie_consultatie || 30;
            console.log('[DEBUG COADA_EFECTIVA] Răspuns primit:', data);
            document.getElementById('patients-in-queue').textContent = queue.length ?? 0;
            document.getElementById('avg-wait-time').textContent = durataMedie ;
            document.getElementById('current-date').textContent = azi.split('-').reverse().join('.');
            const queueCards = document.getElementById('queue-cards-container');
            if (!queueCards) return;
            let html = '';
            if (!Array.isArray(queue) || queue.length === 0) {
                html += '<div style="color:#888;">Nu există pacienți în coadă.</div>';
            } else {
                html += queue.map((p, idx) => {
                    const nrOrdine = `<span style='font-weight:bold;color:#00b8b8;font-size:1.1em;margin-right:10px;'>${idx + 1}.</span>`;
                    if (["in_asteptare", "asteptat", "in_consultatie"].includes(p.status_coada || p.status)) {
                        return `<div class="queue-card queue-item ${p.status_coada}">
                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <div>
                                    ${nrOrdine}<strong>${p.nume_pacient}</strong>
                                    <span style="color:#888;font-size:0.95em;"> (În așteptare)</span>
                                </div>
                                <button onclick="acceptPatient(${p.id_pacient}, '${p.nume_pacient}')" class="accept-btn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em;">
                                    <i class="fas fa-check"></i> Acceptă
                                </button>
                            </div>
                        </div>`;
                    } else {
                        return `<div class="queue-card queue-item ${p.status_coada}">${nrOrdine}${p.nume_pacient} <span style="color:#888;font-size:0.95em;">(${p.status_coada})</span></div>`;
                    }
                }).join('');
            }
            queueCards.innerHTML = html;
        } else {
            document.getElementById('patients-in-queue').textContent = '-';
            document.getElementById('avg-wait-time').textContent = '-';
            document.getElementById('current-date').textContent = azi.split('-').reverse().join('.');
            document.getElementById('queue-cards-container').innerHTML = '<div style="color:red;">Eroare la încărcarea cozii.</div>';
        }
    } catch {
        document.getElementById('patients-in-queue').textContent = '-';
        document.getElementById('avg-wait-time').textContent = '-';
        document.getElementById('current-date').textContent = azi.split('-').reverse().join('.');
        document.getElementById('queue-cards-container').innerHTML = '<div style="color:red;">Eroare la încărcarea cozii.</div>';
    }
}

// --- Actualizare nume pacient selectat în formular ---
function updateSelectedPatientName() {
    const patientSelect = document.getElementById('patient-select');
    const selectedDiv = document.getElementById('selected-patient-name');
    if (patientSelect && selectedDiv) {
        const selectedOption = patientSelect.options[patientSelect.selectedIndex];
        if (selectedOption && selectedOption.value) {
            selectedDiv.textContent = selectedOption.textContent;
        } else {
            selectedDiv.textContent = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const patientSelect = document.getElementById('patient-select');
    if (patientSelect) {
        patientSelect.addEventListener('change', updateSelectedPatientName);
        // Inițializează la încărcare
        updateSelectedPatientName();
    }
});

// Modific acceptPatient să actualizeze și numele vizual:
window.acceptPatient = async function(id_pacient, nume_pacient) {
    const azi = new Date().toISOString().split('T')[0];
    console.log('Acceptare pacient - Data trimisă:', azi);
    try {
        const response = await fetch(`/api/coada/${medicId}/accepta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_pacient, data: azi })
        });
        if (response.ok) {
            alert(`Pacientul ${nume_pacient} a fost acceptat cu succes!`);
            await loadQueue();
            await loadAcceptedPatients();
            // Selectează automat pacientul acceptat în dropdown (cu fallback dacă nu există încă)
            const patientSelect = document.getElementById('patient-select');
            setTimeout(() => {
                if (patientSelect.querySelector(`option[value="${id_pacient}"]`)) {
                    patientSelect.value = id_pacient;
                } else if (patientSelect.options.length > 1) {
                    patientSelect.selectedIndex = 1;
                }
                updateSelectedPatientName(); // Actualizează numele vizual
            }, 200);
            // Setează ora curentă ca ora de început
            const now = new Date();
            const currentTime = now.toTimeString().slice(0, 5);
            document.getElementById('start-time').value = currentTime;
            document.querySelector('.consultation-section').scrollIntoView({ behavior: 'smooth' });
        } else {
            const error = await response.json();
            alert(`Eroare: ${error.message}`);
        }
    } catch (error) {
        alert('Eroare la acceptarea pacientului');
    }
}

// Adaugă ascultător pentru evenimentul socket 'queue-updated' dacă nu există deja
if (typeof socket !== 'undefined') {
    socket.on('queue-updated', async (data) => {
        await loadQueue();
    });
}

// --- PROGRAMĂRI AZI ---
async function loadAppointmentsToday() {
    const azi = new Date().toISOString().split('T')[0];
    try {
        const res = await fetch(`/api/programari/medic/${medicId}/${azi}`);
        const apptCards = document.getElementById('appointments-cards-container');
        if (res.ok) {
            const appointments = await res.json();
            if (appointments.length === 0) {
                apptCards.innerHTML = '<div class="empty-appointments">Nu există programări pentru astăzi</div>';
            } else {
                apptCards.innerHTML = appointments.map(appointment => {
                    const statusClass = appointment.status === 'programata' ? 'status-in-asteptare' :
                                        appointment.status === 'finalizat' ? 'status-finalizat' :
                                        appointment.status === 'anulata' ? 'status-anulat' : 'status-in-asteptare';
                    return `
                        <div class="appointment-card">
                            <div class="appointment-info">
                                <h4>${appointment.nume_pacient}</h4>
                                <p>Ora: ${appointment.ora}</p>
                                <p>Status: <span class="${statusClass}">${appointment.status}</span></p>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        } else {
            apptCards.innerHTML = '<div class="error">Eroare la încărcarea programărilor</div>';
        }
    } catch {
        document.getElementById('appointments-cards-container').innerHTML = '<div class="error">Eroare la încărcarea programărilor</div>';
    }
}

// --- TOATE PROGRAMĂRILE ---
async function loadAllAppointments() {
    console.log('loadAllAppointments called with medicId:', medicId);
    const allAppointmentsTbody = document.getElementById('all-appointments-tbody');
    allAppointmentsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888;"><i class="fas fa-spinner fa-spin"></i> Se încarcă programările...</td></tr>';
    try {
        const url = `/api/programari/medic/${medicId}/all`;
        console.log('Fetching URL:', url);
        const res = await fetch(url);
        console.log('Response:', res);
        if (!res.ok) throw new Error('Eroare la încărcarea programărilor');
        let programari = await res.json();
        console.log('Programări primite:', programari);
        // --- FILTRARE DUPĂ STATUS ---
        const statusFilter = document.getElementById('appointments-status-filter')?.value || 'toate';
        if (statusFilter !== 'toate') {
            programari = programari.filter(p => p.status === statusFilter);
        }
        if (!Array.isArray(programari) || programari.length === 0) {
            allAppointmentsTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888; font-size:1.1em;"><i class="fas fa-calendar-times" style="font-size:1.5em; color:#00b8b8;"></i><br>Nu există programări înregistrate.</td></tr>';
            return;
        }
        allAppointmentsTbody.innerHTML = programari.map(p => `
            <tr>
                <td>${formatDate(p.data)}</td>
                <td>${p.ora}</td>
                <td>${p.nume_pacient || '-'}</td>
                <td>${p.telefon || '-'}</td>
                <td>${getStatusBadge(p.status)}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Eroare la încărcarea programărilor:', err);
        allAppointmentsTbody.innerHTML = '<tr><td colspan="5" style="color:red;">Eroare la încărcarea programărilor.</td></tr>';
    }
}

// --- EVENT LISTENER PENTRU DROPDOWN FILTRARE STATUS ---
document.addEventListener('DOMContentLoaded', () => {
    const statusFilterDropdown = document.getElementById('appointments-status-filter');
    if (statusFilterDropdown) {
        statusFilterDropdown.addEventListener('change', loadAllAppointments);
    }
});

// --- PACIENȚI ACCEPTAȚI ---
async function loadAcceptedPatients() {
    const azi = new Date().toISOString().split('T')[0];
    try {
        const res = await fetch(`/api/coada_pacienti/${medicId}/${azi}`);
        const patientSelect = document.getElementById('patient-select');
        // Salveaza selectia curenta
        const selectedValue = patientSelect.value;
        if (res.ok) {
            const patients = await res.json();
            patientSelect.innerHTML = '<option value="">Selectează pacientul</option>';
            patients.forEach(patient => {
                if (["in_asteptare", "asteptat", "in_consultatie"].includes(patient.status_coada || patient.status)) {
                    const option = document.createElement('option');
                    option.value = patient.id_pacient;
                    option.textContent = patient.nume_pacient;
                    patientSelect.appendChild(option);
                }
            });
            // Dacă există un singur pacient acceptat, selectează-l automat
            if (patientSelect.options.length === 2) {
                patientSelect.selectedIndex = 1;
            } else if (selectedValue) {
                patientSelect.value = selectedValue;
            }
            updateSelectedPatientName();
        }
    } catch {}
}

// --- AUTO-REFRESH ---
function startAutoRefresh() {
    refreshInterval = setInterval(async () => {
        await loadQueue();
        await loadAppointmentsToday();
        await loadAcceptedPatients();
    }, 30000);
}
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}
window.addEventListener('beforeunload', stopAutoRefresh);

// Încarcă toți pacienții consultați de medicul logat
async function loadConsultedPatients() {
    const patientsList = document.getElementById('patients-list');
    const detailsDiv = document.getElementById('patient-details');
    const searchInput = document.getElementById('search-patient');
    
    detailsDiv.style.display = 'none';
    patientsList.innerHTML = '<li style="color:#888; padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Se încarcă pacienții...</li>';
    
    try {
        const res = await fetch(`/api/medici/consultati/${medicId}`);
        if (!res.ok) throw new Error('Eroare la încărcarea pacienților');
        const patients = await res.json();
        
        if (!Array.isArray(patients) || patients.length === 0) {
            patientsList.innerHTML = '<li style="color:#888; padding: 20px; text-align: center;"><i class="fas fa-users"></i> Nu există pacienți consultați.</li>';
            return;
        }
        
        // Funcție de randare filtrată
        function renderFilteredList(filter = '') {
            const filtered = patients.filter(p => (`${p.nume} ${p.prenume}`.toLowerCase().includes(filter.toLowerCase())) );
            
            if (filtered.length === 0) {
                patientsList.innerHTML = '<li style="color:#888; padding: 20px; text-align: center;"><i class="fas fa-search"></i> Niciun pacient găsit.</li>';
                return;
            }
            
            patientsList.innerHTML = filtered.map(p => `
                <li data-id="${p.id_pacient}">
                    <span>${p.nume} ${p.prenume}</span>
                    <i class="fas fa-chevron-right" style="font-size: 0.9em; opacity: 0.6;"></i>
                </li>
            `).join('');
            
            // Adaugă event listeners pentru fiecare pacient
            Array.from(patientsList.children).forEach(li => {
                li.addEventListener('click', async () => {
                    Array.from(patientsList.children).forEach(x => x.classList.remove('selected'));
                    li.classList.add('selected');
                    await showPatientDetails(li.getAttribute('data-id'));
                });
            });
        }
        
        renderFilteredList();
        
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                renderFilteredList(e.target.value);
            };
        }
    } catch (err) {
        console.error('Eroare la încărcarea pacienților:', err);
        patientsList.innerHTML = '<li style="color:red; padding: 20px; text-align: center;"><i class="fas fa-exclamation-triangle"></i> Eroare la încărcarea pacienților.</li>';
    }
}

// Afișează detalii pacient: consultații și mențiuni
async function showPatientDetails(id_pacient) {
    const detailsDiv = document.getElementById('patient-details');
    const infoDiv = document.getElementById('patient-info');
    const consultationDate = document.getElementById('consultation-date');
    const diagnosticContent = document.getElementById('diagnostic-content');
    const treatmentContent = document.getElementById('treatment-content');
    const notesArea = document.getElementById('patient-notes');
    const addToDiagnosticBtn = document.getElementById('add-to-diagnostic-btn');
    const addToTreatmentBtn = document.getElementById('add-to-treatment-btn');
    const notesStatus = document.getElementById('notes-status');
    
    detailsDiv.style.display = '';
    infoDiv.innerHTML = 'Se încarcă detalii...';
    consultationDate.textContent = '-';
    diagnosticContent.textContent = '-';
    treatmentContent.textContent = '-';
    notesArea.value = '';
    notesStatus.textContent = '';
    
    try {
        const res = await fetch(`/api/fisa-medicala/${id_pacient}?id_medic=${medicId}`);
        if (!res.ok) throw new Error('Eroare la detalii pacient');
        const fisa = await res.json();
        
        infoDiv.innerHTML = `<b>Nume:</b> ${fisa.pacient.nume_complet}<br><b>Vârstă:</b> ${fisa.pacient.varsta} ani<br><b>Email:</b> ${fisa.pacient.email || '-'}<br><b>Telefon:</b> ${fisa.pacient.telefon || '-'}`;
        
        if (fisa.istoric_consultatii && fisa.istoric_consultatii.length > 0) {
            // Afișează ultima consultație
            const c = fisa.istoric_consultatii[0];
            consultationDate.textContent = c.data || '-';
            diagnosticContent.textContent = c.diagnostic || '-';
            treatmentContent.textContent = c.tratament || '-';
        } else {
            consultationDate.textContent = 'Nu există consultații';
            diagnosticContent.textContent = 'Nu există diagnostic';
            treatmentContent.textContent = 'Nu există tratament';
        }
        
        // Event listeners pentru butoanele de adăugare mențiuni
        addToDiagnosticBtn.onclick = async () => {
            if (!notesArea.value.trim()) {
                notesStatus.textContent = 'Scrie o mențiune înainte de a adăuga!';
                return;
            }
            
            notesStatus.textContent = 'Se adaugă la diagnostic...';
            try {
                const currentDiagnostic = diagnosticContent.textContent === '-' ? '' : diagnosticContent.textContent;
                const newDiagnostic = currentDiagnostic + (currentDiagnostic ? '\n' : '') + notesArea.value;
                
                // Găsește ultima consultație pentru acest pacient
                if (fisa.istoric_consultatii && fisa.istoric_consultatii.length > 0) {
                    const ultimaConsultatie = fisa.istoric_consultatii[0];
                    const consultationId = ultimaConsultatie.id_consultatie;
                    
                    // Trimite request către server pentru actualizarea diagnosticului
                    const response = await fetch(`/api/consultatii/update-diagnostic/${consultationId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ diagnostic: newDiagnostic })
                    });
                    
                    if (response.ok) {
                        diagnosticContent.textContent = newDiagnostic;
                        notesArea.value = '';
                        notesStatus.textContent = 'Mențiune adăugată la diagnostic!';
                    } else {
                        notesStatus.textContent = 'Eroare la salvarea în baza de date!';
                    }
                } else {
                    notesStatus.textContent = 'Nu există consultații pentru acest pacient!';
                }
                
            } catch (err) {
                console.error('Eroare la adăugarea mențiunii:', err);
                notesStatus.textContent = 'Eroare la adăugarea mențiunii!';
            }
        };
        
        addToTreatmentBtn.onclick = async () => {
            if (!notesArea.value.trim()) {
                notesStatus.textContent = 'Scrie o mențiune înainte de a adăuga!';
                return;
            }
            
            notesStatus.textContent = 'Se adaugă la tratament...';
            try {
                const currentTreatment = treatmentContent.textContent === '-' ? '' : treatmentContent.textContent;
                const newTreatment = currentTreatment + (currentTreatment ? '\n' : '') + notesArea.value;
                
                // Găsește ultima consultație pentru acest pacient
                if (fisa.istoric_consultatii && fisa.istoric_consultatii.length > 0) {
                    const ultimaConsultatie = fisa.istoric_consultatii[0];
                    const consultationId = ultimaConsultatie.id_consultatie;
                    
                    // Trimite request către server pentru actualizarea tratamentului
                    const response = await fetch(`/api/consultatii/update-tratament/${consultationId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tratament: newTreatment })
                    });
                    
                    if (response.ok) {
                        treatmentContent.textContent = newTreatment;
                        notesArea.value = '';
                        notesStatus.textContent = 'Mențiune adăugată la tratament!';
                    } else {
                        notesStatus.textContent = 'Eroare la salvarea în baza de date!';
                    }
                } else {
                    notesStatus.textContent = 'Nu există consultații pentru acest pacient!';
                }
                
            } catch (err) {
                console.error('Eroare la adăugarea mențiunii:', err);
                notesStatus.textContent = 'Eroare la adăugarea mențiunii!';
            }
        };
        
    } catch (err) {
        infoDiv.innerHTML = '<span style="color:red;">Eroare la încărcarea detaliilor pacientului.</span>';
    }
}

async function loadMedicProfile() {
    try {
        const res = await fetch(`/api/medic/${medicId}`);
        if (!res.ok) throw new Error('Eroare la încărcarea profilului');
        const medic = await res.json();
        // Data înregistrării statică (aprox. 1.5 luni în urmă)
        const dataInregistrare = '01.04.2024';
        // Poza de profil: dacă există upload, folosește-o, altfel default
        let imgSrc = `/images/profile/medic_${medicId}.jpg`;
        // Testăm dacă poza există
        try {
            const testImg = await fetch(imgSrc, { method: 'HEAD' });
            if (!testImg.ok) {
                imgSrc = '../images/doctors/d1.jpg';
                if (medic.gen === 0 || medic.gen === false || medic.gen === 'false' || medic.gen === '0') {
                    imgSrc = '../images/doctors/d2.jpg';
                }
            }
        } catch {
            imgSrc = '../images/doctors/d1.jpg';
            if (medic.gen === 0 || medic.gen === false || medic.gen === 'false' || medic.gen === '0') {
                imgSrc = '../images/doctors/d2.jpg';
            }
        }
        document.getElementById('profile-pic').src = imgSrc;
        // Populează profilul doar cu câmpurile din baza de date + data înregistrării
        const infoHtml = `
            <h3 style="margin-bottom:8px;">Dr. ${medic.nume || ''}</h3>
            <div class="profile-fields">
                <div><span class="profile-label">Specializare:</span> <span>${medic.specializare || '-'}</span></div>
                <div><span class="profile-label">Email:</span> <span>${medic.email || '-'}</span></div>
                <div><span class="profile-label">Telefon:</span> <span>${medic.telefon || '-'}</span></div>
                <div><span class="profile-label">Rating:</span> <span>${medic.rating !== undefined && medic.rating !== null ? Number(medic.rating).toFixed(2) : 'N/A'}</span></div>
                <div><span class="profile-label">Data înregistrării:</span> <span>${dataInregistrare}</span></div>
            </div>
        `;
        document.getElementById('profile-info').innerHTML = infoHtml;
    } catch (err) {
        document.getElementById('profile-info').innerHTML = '<span style="color:red">Eroare la încărcarea profilului</span>';
    }
}

async function loadMedicStats() {
    console.log('Apel loadMedicStats');
    const cards = document.getElementById('stats-cards');
    const graph = document.getElementById('stats-graph');
    cards.innerHTML = '<div style="width:100%;text-align:center;color:#888;">Se încarcă...</div>';
    try {
        const res = await fetch(`/api/medici/statistici/${medicId}`);
        if (!res.ok) throw new Error('Eroare la încărcarea statisticilor');
        const data = await res.json();
        // Carduri statistici principale
        cards.innerHTML = `
            <div class="stat-card"><div class="stat-label">Total consultații</div><div class="stat-value">${data.totalConsultatii}</div></div>
            <div class="stat-card"><div class="stat-label">Pacienți unici</div><div class="stat-value">${data.pacientiUnici}</div></div>
            <div class="stat-card"><div class="stat-label">Programări anulate/neprezentate</div><div class="stat-value">${data.anulate}</div></div>
            <div class="stat-card"><div class="stat-label">Durată medie consultație</div><div class="stat-value">${data.durataMedie ? data.durataMedie.toFixed(1) : '-'} min</div></div>
            <div class="stat-card"><div class="stat-label">Venit total</div><div class="stat-value">${data.venitTotal ? data.venitTotal.toFixed(2) : '0'} RON</div></div>
            <div class="stat-card"><div class="stat-label">Rating mediu</div><div class="stat-value">${data.rating !== null ? Number(data.rating).toFixed(2) : '-'}</div></div>
            <div class="stat-card"><div class="stat-label">% programări onorate</div><div class="stat-value">${data.procentOnorate !== null ? data.procentOnorate + '%' : '-'}</div></div>
            <div class="stat-card"><div class="stat-label">% programări anulate/neprezentate</div><div class="stat-value">${data.procentAnulate !== null ? data.procentAnulate + '%' : '-'}</div></div>
            <div class="stat-card" style="flex:1 1 100%;max-width:100%;"><div class="stat-label">Top diagnostice</div><div class="stat-value">${data.topDiagnostice && data.topDiagnostice.length ? `<ul style='margin:0;padding-left:18px;text-align:left;'>${data.topDiagnostice.map(d => `<li style='margin-bottom:4px;list-style-type:disc;'><i class='fas fa-notes-medical' style='color:#1976d2;margin-right:6px;'></i> ${d.diagnostic}</li>`).join('')}</ul>` : '-'}</div></div>
            <div class="stat-card" id="stat-intervale-orare" style="flex:1 1 100%;max-width:100%;margin-top:12px;"><div class="stat-label">Intervale orare aglomerate</div><div class="stat-value" id="stat-intervale-orare-list"><span style='color:#888;'>Se încarcă...</span></div></div>
        `;
        // Grafic evoluție zilnică
        try {
          const resEvolutie = await fetch(`/api/medici/statistici/evolutie-zilnica/${medicId}`);
          if (resEvolutie.ok) {
            const evolutieZilnica = await resEvolutie.json();
            const labels = evolutieZilnica.map(e => e.data);
            const values = evolutieZilnica.map(e => e.nr);
            if (statsChart) statsChart.destroy();
            statsChart = new Chart(graph.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Consultații/zi',
                        data: values,
                        backgroundColor: 'rgba(0,123,255,0.5)',
                        borderColor: '#007bff',
                        borderWidth: 1,
                        pointRadius: 0,
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: { title: { display: true, text: 'Ziua' } },
                        y: { title: { display: true, text: 'Nr. consultații' }, beginAtZero: true, precision:0 }
                    }
                }
            });
          } else {
            graph.parentElement.innerHTML = '<div style="color:red;text-align:center;">Eroare la încărcarea evoluției zilnice.</div>';
          }
        } catch {
          graph.parentElement.innerHTML = '<div style="color:red;text-align:center;">Eroare la încărcarea evoluției zilnice.</div>';
        }
        // --- NOU: Fetch intervale orare aglomerate ---
        try {
          const resIntervale = await fetch(`/api/medici/statistici/intervale-orare/${medicId}`);
          const listaDiv = document.getElementById('stat-intervale-orare-list');
          if (resIntervale.ok) {
            const intervale = await resIntervale.json();
            if (intervale.length === 0) {
              listaDiv.innerHTML = `<span style='color:#888;'>Nu există date suficiente.</span>`;
            } else {
              listaDiv.innerHTML = `<ul style='margin:0;padding-left:18px;'>${intervale.map((row, idx) => `<li style='margin-bottom:4px;'><i class='fas fa-clock' style='color:#1976d2;margin-right:6px;'></i> <b>${row.interval}</b> <span style='color:#888;'>(${row.nr} consultații)</span></li>`).join('')}</ul>`;
            }
          } else {
            listaDiv.innerHTML = `<span style='color:red;'>Eroare la încărcarea intervalelor orare.</span>`;
          }
        } catch {
          const listaDiv = document.getElementById('stat-intervale-orare-list');
          if (listaDiv) listaDiv.innerHTML = `<span style='color:red;'>Eroare la încărcarea intervalelor orare.</span>`;
        }
    } catch (err) {
        cards.innerHTML = '<div style="width:100%;text-align:center;color:red;">Eroare la încărcarea statisticilor.</div>';
        if (statsChart) statsChart.destroy();
    }
}
