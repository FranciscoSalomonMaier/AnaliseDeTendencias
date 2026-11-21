const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');
(async () => {
  const root = resolve(__dirname, '..');
  if (existsSync(resolve(root, '.env')))
    process.loadEnvFile(resolve(root, '.env'));
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await c.connect();
    await c.query(
      readFileSync(
        resolve(root, 'migrations/025_short_intelligent_jobs.sql'),
        'utf8',
      ),
    );
    console.log('Migration 025: cancelamento de jobs pronto.');
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(
    'Falha na migration 025:',
    e.code ?? 'erro',
    'Aguarde tarefas ativas terminarem e confira a conexão.',
  );
  process.exitCode = 1;
});
