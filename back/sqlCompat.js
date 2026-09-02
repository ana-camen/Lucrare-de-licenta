const PK_COLUMNS = {
  pacient: 'id_pacient',
  medic: 'id_medic',
  programare: 'id_programare',
  consultatie: 'id_consultatie',
  fisa_medicala: 'id_fisa',
  feedback: 'id_feedback',
  statistica: 'id_statistica',
  coada_asteptare: 'id'
};

function convertSql(sql, params = []) {
  let text = sql;

  text = text.replace(/date\s*\(\s*'now'\s*,\s*'-(\d+)\s*days'\s*\)/gi, "(CURRENT_DATE - INTERVAL '$1 days')::text");
  text = text.replace(/strftime\s*\(\s*'%Y-%W'\s*,\s*data\s*\)/gi, "TO_CHAR(data::date, 'IYYY-IW')");
  text = text.replace(/"([^"]+)"/g, "'$1'");

  const values = [...params];
  let index = 0;
  text = text.replace(/\?/g, () => `$${++index}`);

  return { text, values };
}

function addReturningForInsert(sql) {
  const match = sql.match(/^\s*INSERT\s+INTO\s+(\w+)/i);
  if (!match || /RETURNING/i.test(sql)) {
    return sql;
  }

  const pkCol = PK_COLUMNS[match[1].toLowerCase()];
  if (!pkCol) {
    return sql;
  }

  return `${sql.replace(/;\s*$/, '')} RETURNING ${pkCol}`;
}

module.exports = { convertSql, addReturningForInsert, PK_COLUMNS };
