# Migrare SQLite -> PostgreSQL

Acest ghid explica cum sa muti baza de date `clinica.db` (SQLite) in PostgreSQL, pastrand toate datele existente.

## Cerinte

- Node.js instalat
- PostgreSQL instalat local sau cont pe un serviciu cloud (Render, Supabase, Railway etc.)

## Pasul 1: Creeaza baza de date PostgreSQL

In psql sau pgAdmin:

```sql
CREATE DATABASE clinica;
```

## Pasul 2: Configureaza credentialele

In folderul `back/`:

```bash
copy .env.example .env
```

Editeaza `.env` cu user, parola si numele bazei tale:

```
DATABASE_URL=postgresql://postgres:parola_ta@localhost:5432/clinica
```

## Pasul 3: Instaleaza dependentele

```bash
cd back
npm install
```

## Pasul 4: Ruleaza migrarea

```bash
npm run migrate
```

Scriptul `scripts/migrate-sqlite-to-pg.js`:

1. Citeste toate datele din `clinica.db`
2. Creeaza tabelele in PostgreSQL (`queries-pg.sql`)
3. Copiaza randurile in ordinea corecta (respectand cheile straine)
4. Reseteaza secventele de ID-uri

## Pasul 5: Porneste aplicatia

```bash
npm start
```

Serverul se conecteaza acum la PostgreSQL folosind setarile din `.env`.

## Fisiere relevante

| Fisier | Rol |
|--------|-----|
| `queries-pg.sql` | Schema PostgreSQL |
| `db.js` | Conexiune PostgreSQL (compatibil cu API-ul vechi SQLite) |
| `sqlCompat.js` | Converteste sintaxa SQLite la PostgreSQL |
| `scripts/migrate-sqlite-to-pg.js` | Scriptul de migrare a datelor |

## Note

- Fisierul `clinica.db` ramane ca backup; aplicatia nu il mai foloseste dupa migrare.
- Daca rulezi pe Render/Supabase, seteaza `PGSSL=true` in `.env`.
- Poti rerula `npm run migrate` oricand; scriptul goleste tabelele PostgreSQL inainte de import.
