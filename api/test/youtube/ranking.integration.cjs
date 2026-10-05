// Explicit disposable-database URL required. Never run against production.
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const sql = readFileSync('src/sources/youtube/youtube-metrics.repository.ts', 'utf8').match(/RANKING_SQL = `([\s\S]*?)`;/)[1];
async function main() {
  if (!process.env.YOUTUBE_TEST_DATABASE_URL) throw new Error('Define YOUTUBE_TEST_DATABASE_URL for a disposable test database');
  const client = new Client({ connectionString: process.env.YOUTUBE_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(readFileSync('migrations/001_youtube_metric_snapshots.sql', 'utf8'));
    await client.query('BEGIN');
    const captureSql = readFileSync('src/sources/youtube/youtube-metrics.repository.ts', 'utf8').match(/`\n      WITH input([\s\S]*?)`/)[0].slice(1, -1);
    const sample = [{ id: 'capture-test', snippet: { title: 'Capture' }, categoryTitle: 'Music', statistics: { viewCount: '1000' } }];
    const slot = new Date('2026-10-04T12:00:00Z');
    await client.query(captureSql, [JSON.stringify(sample), 'BR', slot, slot]);
    delete sample[0].categoryTitle;
    sample[0].statistics.viewCount = '2500';
    await client.query(captureSql, [JSON.stringify(sample), null, new Date('2026-10-04T12:30:00Z'), slot]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM youtube_video_metric_snapshots WHERE video_id='capture-test'")).rows[0].n, 1);
    assert.equal((await client.query("SELECT video->>'categoryTitle' AS category FROM youtube_videos WHERE id='capture-test'")).rows[0].category, 'Music');

    const start = new Date('2026-09-27T12:00:00Z');
    const now = new Date('2026-10-04T12:00:00Z');
    async function video(id, snapshots, publishedAt = '2020-01-01') {
      await client.query('INSERT INTO youtube_videos VALUES($1,$2)', [id, JSON.stringify({ id, snippet: { title: id, publishedAt } })]);
      await client.query('INSERT INTO youtube_video_regions VALUES($1,$2)', [id, 'BR']);
      for (const [at, views] of snapshots) await client.query('INSERT INTO youtube_video_metric_snapshots(video_id,view_count,captured_at,capture_slot) VALUES($1,$2,$3,$3)', [id, views, at]);
    }
    await video('normal', [[start, 1000], [now, 2500]]);
    await video('negative', [[start, 3000], [now, 2500]]);
    await video('partial', [['2026-10-02T12:00Z', 100], [now, 400]]);
    await video('new', [['2026-10-03T12:00Z', 1000], [now, 1100]], '2026-10-03');
    await video('baseline', [['2026-09-26T12:00Z', 10], [start, 100], ['2026-09-28T12:00Z', 200], ['2026-10-04T11:30Z', 500], [now, 600], ['2026-10-05T12:00Z', 900]]);
    await video('single', [[now, 999999]]);
    await video('empty', []);
    await video('old', [['2026-09-01T12:00Z', 500]]);
    const rows = (await client.query(sql, ['BR', start, now])).rows;
    const byId = Object.fromEntries(rows.map(r => [r.video.id, r]));
    assert.equal(byId.normal.viewsInPeriod, '1500');
    assert.equal(byId.negative.viewsInPeriod, '0');
    assert.equal(byId.partial.hasFullPeriodData, false);
    assert.equal(byId.new.baselineViews, '1000');
    assert.equal(byId.new.hasFullPeriodData, false);
    assert.equal(byId.baseline.baselineViews, '100');
    assert.equal(byId.baseline.currentViews, '600');
    assert.equal(byId.single.viewsInPeriod, '0');
    assert.equal(byId.single.hasFullPeriodData, false);
    assert.equal(byId.empty, undefined);
    assert.equal(byId.old.viewsInPeriod, '0');
    assert.equal(byId.old.hasFullPeriodData, false);
    assert.equal(rows[0].video.id, 'normal');
    for (const r of rows) assert.equal(r.viewsInPeriod, String(BigInt(r.currentViews) > BigInt(r.baselineViews) ? BigInt(r.currentViews) - BigInt(r.baselineViews) : 0n));
    for (let i = 0; i < 60; i++) await video(`extra-${i}`, [[start, '9007199254740993'], [now, '9007199254742993']]);
    const top = (await client.query(sql, ['BR', start, now])).rows;
    assert.equal(top.length, 50);
    assert.ok(top.every(r => r.viewsInPeriod === '2000'));
    assert.equal(top[0].currentViews, '9007199254742993');
    const plan = await client.query('EXPLAIN ' + sql, ['BR', start, now]);
    console.log('PASS: migration, delta, negative clamp, partial, new video, baseline, latest, ranking, limit, insufficient history, BIGINT, EXPLAIN');
    console.log(plan.rows.map(r => r['QUERY PLAN']).join('\n'));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
