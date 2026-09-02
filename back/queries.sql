-- TABEL PACIENT
CREATE TABLE IF NOT EXISTS pacient (
  id_pacient INTEGER PRIMARY KEY AUTOINCREMENT,
  nume TEXT NOT NULL,
  prenume TEXT NOT NULL,
  data_nasterii TEXT,
  gen BOOLEAN, -- true = masculin, false = feminin
  email TEXT UNIQUE NOT NULL,
  telefon TEXT,
  parola TEXT NOT NULL,
  cnp TEXT UNIQUE,
  data_inregistrare TEXT
);

-- TABEL MEDIC
CREATE TABLE IF NOT EXISTS medic (
  id_medic INTEGER PRIMARY KEY AUTOINCREMENT,
  nume TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telefon TEXT,
  parola TEXT NOT NULL,
  specializare TEXT NOT NULL,
  rating REAL DEFAULT 0.0,
  disponibilitate BOOLEAN DEFAULT 1 -- true = disponibil
);

-- TABEL PROGRAMARE
CREATE TABLE IF NOT EXISTS programare (
  id_programare INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pacient INTEGER NOT NULL,
  id_medic INTEGER NOT NULL,
  data TEXT NOT NULL,
  ora TEXT NOT NULL,
  status TEXT DEFAULT 'programata',
  FOREIGN KEY (id_pacient) REFERENCES pacient(id_pacient),
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic)
);

-- TABEL CONSULTATIE
CREATE TABLE IF NOT EXISTS consultatie (
  id_consultatie INTEGER PRIMARY KEY AUTOINCREMENT,
  id_programare INTEGER,
  id_medic INTEGER NOT NULL,
  id_pacient INTEGER NOT NULL,
  data TEXT NOT NULL,
  ora_start TEXT,
  ora_sfarsit TEXT,
  durata REAL,
  diagnostic TEXT,
  tratament TEXT,
  cost REAL,
  FOREIGN KEY (id_programare) REFERENCES programare(id_programare),
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic),
  FOREIGN KEY (id_pacient) REFERENCES pacient(id_pacient)
);


-- TABEL FIȘĂ MEDICALĂ
CREATE TABLE IF NOT EXISTS fisa_medicala (
  id_fisa INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pacient INTEGER NOT NULL,
  id_medic INTEGER NOT NULL,
  diagnostic TEXT,
  tratament TEXT,
  observatii TEXT,
  data_actualizare TEXT,
  FOREIGN KEY (id_pacient) REFERENCES pacient(id_pacient),
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic)
);

-- TABEL FEEDBACK
CREATE TABLE IF NOT EXISTS feedback (
  id_feedback INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pacient INTEGER NOT NULL,
  id_medic INTEGER NOT NULL,
  scor REAL CHECK (scor >= 1 AND scor <= 5),
  comentariu TEXT,
  data TEXT,
  FOREIGN KEY (id_pacient) REFERENCES pacient(id_pacient),
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic)
);

-- TABEL STATISTICĂ
CREATE TABLE IF NOT EXISTS statistica (
  id_statistica INTEGER PRIMARY KEY AUTOINCREMENT,
  id_medic INTEGER NOT NULL,
  data TEXT,
  nr_pacienti INTEGER,
  durata_medie_consultatie REAL,
  timp_mediu_asteptare REAL,
  nr_pacienti_anulati INTEGER,
  consultatii_peste_1h INTEGER,
  cost_mediu_consultatie REAL,
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic)
);

-- TABEL COADĂ AȘTEPTARE
CREATE TABLE IF NOT EXISTS coada_asteptare (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pacient INTEGER NOT NULL,
  id_medic INTEGER NOT NULL,
  data TEXT,
  ora_sosire TEXT,
  status TEXT DEFAULT 'in_asteptare',
  FOREIGN KEY (id_pacient) REFERENCES pacient(id_pacient),
  FOREIGN KEY (id_medic) REFERENCES medic(id_medic)
);
