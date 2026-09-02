-- Schema PostgreSQL pentru clinica dentara
-- Rulat automat la pornirea serverului sau manual inainte de migrare

CREATE TABLE IF NOT EXISTS pacient (
  id_pacient SERIAL PRIMARY KEY,
  nume TEXT NOT NULL,
  prenume TEXT NOT NULL,
  data_nasterii TEXT,
  gen BOOLEAN,
  email TEXT UNIQUE NOT NULL,
  telefon TEXT,
  parola TEXT NOT NULL,
  cnp TEXT UNIQUE,
  data_inregistrare TEXT
);

CREATE TABLE IF NOT EXISTS medic (
  id_medic SERIAL PRIMARY KEY,
  nume TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telefon TEXT,
  parola TEXT NOT NULL,
  specializare TEXT NOT NULL,
  rating DOUBLE PRECISION DEFAULT 0.0,
  disponibilitate BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS programare (
  id_programare SERIAL PRIMARY KEY,
  id_pacient INTEGER NOT NULL REFERENCES pacient(id_pacient),
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  data TEXT NOT NULL,
  ora TEXT NOT NULL,
  status TEXT DEFAULT 'programata',
  motiv_anulare TEXT
);

CREATE TABLE IF NOT EXISTS consultatie (
  id_consultatie SERIAL PRIMARY KEY,
  id_programare INTEGER REFERENCES programare(id_programare),
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  id_pacient INTEGER NOT NULL REFERENCES pacient(id_pacient),
  data TEXT NOT NULL,
  ora_start TEXT,
  ora_sfarsit TEXT,
  durata DOUBLE PRECISION,
  diagnostic TEXT,
  tratament TEXT,
  cost DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS fisa_medicala (
  id_fisa SERIAL PRIMARY KEY,
  id_pacient INTEGER NOT NULL REFERENCES pacient(id_pacient),
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  diagnostic TEXT,
  tratament TEXT,
  observatii TEXT,
  data_actualizare TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id_feedback SERIAL PRIMARY KEY,
  id_pacient INTEGER NOT NULL REFERENCES pacient(id_pacient),
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  scor DOUBLE PRECISION CHECK (scor >= 1 AND scor <= 5),
  comentariu TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS statistica (
  id_statistica SERIAL PRIMARY KEY,
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  data TEXT,
  nr_pacienti INTEGER,
  durata_medie_consultatie DOUBLE PRECISION,
  timp_mediu_asteptare DOUBLE PRECISION,
  nr_pacienti_anulati INTEGER,
  consultatii_peste_1h INTEGER,
  cost_mediu_consultatie DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS coada_asteptare (
  id SERIAL PRIMARY KEY,
  id_pacient INTEGER NOT NULL REFERENCES pacient(id_pacient),
  id_medic INTEGER NOT NULL REFERENCES medic(id_medic),
  data TEXT,
  ora_sosire TEXT,
  status TEXT DEFAULT 'in_asteptare'
);
