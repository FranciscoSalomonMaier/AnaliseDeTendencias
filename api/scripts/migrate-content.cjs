const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');
(async () => {
  const root = resolve(__dirname, '..');
  if (existsSync(resolve(root, '.env')))
    process.loadEnvFile(resolve(root, '.env'));
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL não configurada');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query(
      readFileSync(
        resolve(root, 'migrations/004_content_projects.sql'),
        'utf8',
      ),
    );
    console.log(
      'Migration de projetos aplicada. Conteúdos existentes preservados.',
    );
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(
    `Falha na migration de projetos (${e.code ?? 'erro'}). Verifique o banco.`,
  );
  process.exitCode = 1;
});
