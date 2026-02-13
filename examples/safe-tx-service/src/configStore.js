import { pool } from './db.js';

export async function getConfig(key) {
  const result = await pool.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return result.rowCount ? result.rows[0].value : null;
}

export async function setConfig(key, value) {
  await pool.query(
    `INSERT INTO app_config (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, String(value)]
  );
}

export async function getAllConfig() {
  const result = await pool.query('SELECT key, value FROM app_config ORDER BY key ASC');
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}
