const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const root = resolve(__dirname, '..');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não está configurada');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    for (const migration of ['001_youtube_metric_snapshots.sql', '002_semantic_topics.sql', '003_canonical_topics.sql']) {
      await client.query(readFileSync(resolve(root, 'migrations', migration), 'utf8'));
    }
    const result = await client.query(`
      SELECT to_regclass('youtube_collection_regions') IS NOT NULL
        AND to_regclass('youtube_videos') IS NOT NULL
        AND to_regclass('youtube_video_regions') IS NOT NULL
        AND to_regclass('youtube_video_metric_snapshots') IS NOT NULL
        AND to_regclass('youtube_video_embeddings') IS NOT NULL
        AND to_regclass('youtube_semantic_topics') IS NOT NULL
        AND to_regclass('youtube_video_topics') IS NOT NULL
        AND to_regclass('youtube_semantic_processing_runs') IS NOT NULL AS ready
    `);
    if (!result.rows[0].ready) throw new Error('Tabelas de snapshots não foram encontradas após a migration');
    console.log('Migration YouTube aplicada: oito tabelas verificadas. Nenhum dado foi excluído.');
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(`Falha na migration YouTube (${error.code ?? 'erro'}). Verifique a conexão e as permissões do banco.`);
  process.exitCode = 1;
});
