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
      'CREATE TABLE IF NOT EXISTS content_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    // Serialize schema application across API installations using this runner.
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('content-schema:migrations',0))",
    );
    for (const file of [
      '004_content_projects.sql',
      '005_content_visual_assets.sql',
      '006_content_narration.sql',
      '007_video_renders.sql',
    ]) {
      const applied = await client.query(
        'SELECT 1 FROM content_schema_migrations WHERE name=$1',
        [file],
      );
      if (applied.rowCount) continue;
      // Existing deployments used idempotent SQL without a journal. Adopt their schema before upgrades.
      if (
        file === '004_content_projects.sql' ||
        file === '005_content_visual_assets.sql' ||
        file === '006_content_narration.sql'
      ) {
        const marker = file.startsWith('004')
          ? ['content_generation_runs', 'project_config']
          : file.startsWith('005')
            ? ['content_assets', 'storage_key']
            : ['content_assets', 'voice'];
        const exists = await client.query(
          'SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2',
          marker,
        );
        if (exists.rowCount) {
          await client.query(
            'INSERT INTO content_schema_migrations(name) VALUES($1)',
            [file],
          );
          continue;
        }
      }
      await client.query(
        readFileSync(resolve(root, 'migrations', file), 'utf8'),
      );
      await client.query(
        'INSERT INTO content_schema_migrations(name) VALUES($1)',
        [file],
      );
    }
    console.log(
      'Migrations de projetos e assets aplicadas. Dados existentes preservados.',
    );
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(
    `Falha na migration de assets (${e.code ?? 'erro'}). Verifique o banco.`,
  );
  process.exitCode = 1;
});
