const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const source = readFileSync('src/sources/youtube/youtube-period.sql.ts', 'utf8');
const base = source.match(/VIDEO_PERIOD_SQL = `([\s\S]*?)`;/)[1];
const sql = readFileSync('trends/trending-topics.sql.ts', 'utf8').match(/TOPIC_AGGREGATION_SQL = `([\s\S]*?)`;/)[1].replace('${VIDEO_PERIOD_SQL}', base);
async function main() {
  if (!process.env.YOUTUBE_TEST_DATABASE_URL) throw new Error('Use a disposable test database URL');
  const client = new Client({ connectionString: process.env.YOUTUBE_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(readFileSync('migrations/001_youtube_metric_snapshots.sql', 'utf8'));
    await client.query('BEGIN');
    const start = new Date('2026-09-28T12:00Z');
    const now = new Date('2026-10-05T12:00Z');
    const membership = [];
    async function video(id, topic, current, baseline, at = start) {
      await client.query('INSERT INTO youtube_videos VALUES($1,$2)', [id, JSON.stringify({id, snippet:{title:id,channelTitle:'Channel'}})]);
      await client.query("INSERT INTO youtube_video_regions VALUES($1,'BR')", [id]);
      if (baseline !== null) await client.query('INSERT INTO youtube_video_metric_snapshots(video_id,view_count,captured_at,capture_slot) VALUES($1,$2,$3,$3)', [id,baseline,at]);
      if (current !== null) await client.query('INSERT INTO youtube_video_metric_snapshots(video_id,view_count,captured_at,capture_slot) VALUES($1,$2,$3,$3)', [id,current,now]);
      membership.push({ video_id:id,topic_id:topic });
    }
    await video('a1','A',2000,1000);
    await video('a2','A',5000,3000);
    await video('b1','B',15000,5000);
    await video('partial','P',500,100,new Date('2026-10-04T12:00Z'));
    await video('single','P',900,null);
    await video('no-snapshot','empty',null,null);
    membership.push({ video_id:'a1',topic_id:'A' });
    async function ranking(limit = 20) { return (await client.query(sql,['BR',start,now,JSON.stringify(membership),limit])).rows; }
    let rows = await ranking();
    const byId = Object.fromEntries(rows.map(row => [row.id,row]));
    assert.equal(byId.A.videoCount,2);
    assert.equal(byId.A.totalViews,'7000');
    assert.equal(byId.A.viewsInPeriod,'3000');
    assert.equal(rows[0].id,'B');
    assert.equal(byId.A.hasFullPeriodData,true);
    assert.equal(byId.P.hasFullPeriodData,false);
    assert.equal(byId.P.actualHistorySeconds,0);
    assert.equal(byId.P.viewsInPeriod,'400');
    assert.equal(byId.empty,undefined);
    assert.deepEqual(byId.A.topVideos.map(v => v.id),['a2','a1']);
    assert.equal((await ranking(1)).length,1);
    const deltas = [100000,200000,350000];
    for (let i=0;i<3;i++) await video(`manual-${i}`,'manual',deltas[i]+1000,1000);
    assert.equal((await ranking()).find(t=>t.id==='manual').viewsInPeriod,'650000');
    for (let i=0;i<60;i++) await video(`large-${i}`,'large',String(9007199254740993n+BigInt(i+1)), '9007199254740993');
    const large = (await ranking()).find(t=>t.id==='large');
    assert.equal(large.videoCount,60);
    assert.equal(large.viewsInPeriod,'1830');
    assert.equal(large.totalViews,String(60n*9007199254740993n+1830n));
    assert.deepEqual(large.topVideos.map(v=>v.id),['large-59','large-58','large-57','large-56','large-55']);
    assert.equal(large.topVideos.length,5);
    console.log('PASS: aggregation, descending ranking, videoCount, totalViews, period growth, limit, partial, empty, insufficient snapshots, deduplication, topVideos, >50 videos, BIGINT');
    console.log('Manual check: 100000 + 200000 + 350000 = 650000');
    console.log((await client.query('EXPLAIN '+sql,['BR',start,now,JSON.stringify(membership),20])).rows.map(r=>r['QUERY PLAN']).join('\n'));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
