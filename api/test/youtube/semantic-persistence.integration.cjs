const {Client}=require('pg');const {readFileSync}=require('node:fs');const assert=require('node:assert/strict');
const {SemanticTopicsRepository}=require('../../dist/trends/semantic/semantic-topics.repository');
(async()=>{
 if(!process.env.YOUTUBE_TEST_DATABASE_URL)throw new Error('Disposable database required');
 const c=new Client({connectionString:process.env.YOUTUBE_TEST_DATABASE_URL}),other=new Client({connectionString:process.env.YOUTUBE_TEST_DATABASE_URL});
 try{await c.connect();await other.connect();for(const migration of ['001_youtube_metric_snapshots.sql','002_semantic_topics.sql','003_canonical_topics.sql'])await c.query(readFileSync('migrations/'+migration,'utf8'));
 const repo=new SemanticTopicsRepository({withClient:work=>work(c)});
 await c.query('BEGIN');
 await c.query(`INSERT INTO youtube_videos VALUES('semantic-a','{"id":"semantic-a","snippet":{"title":"Batman"}}')`);
 await repo.saveEmbeddings(c,[{video_id:'semantic-a',source_hash:'hash-1',vector:[1,0]}],'test-model');
 assert.equal((await repo.embeddings(c,['semantic-a'],'test-model'))[0].source_hash,'hash-1');
 await repo.saveEmbeddings(c,[{video_id:'semantic-a',source_hash:'hash-2',vector:[0,1]}],'test-model');
 assert.equal((await repo.embeddings(c,['semantic-a'],'test-model'))[0].source_hash,'hash-2');
 assert.deepEqual((await repo.embeddings(c,['semantic-a'],'other-model')),[]);
 await c.query('ROLLBACK');
 await c.query('BEGIN');await c.query(`INSERT INTO youtube_videos VALUES('semantic-a','{"id":"semantic-a"}')`);await c.query('COMMIT');
 const id='00000000-0000-4000-8000-000000000099';
 const topic={id,name:'Batman',primary_topic:'Batman',canonical_key:'batman',confidence:.95,keywords:['Batman','Gotham'],entities:['Batman'],centroid:[1,0],naming_source:'entity',naming_hash:'hash',member_ids:['semantic-a'],retry_after:null};
 await repo.publish(c,'BR','test-model',[topic],[{video_id:'semantic-a',topic_id:id,source_hash:'hash'}]);
 assert.equal((await repo.existing(c,'BR','test-model'))[0].name,'Batman');
 assert.equal((await repo.existing(c,'BR','test-model'))[0].canonical_key,'batman');
 try{await repo.publish(c,'BR','test-model',[{...topic,name:'Should Roll Back'}],[{video_id:'missing-video',topic_id:id,source_hash:'hash'}]);assert.fail('FK expected');}catch(error){assert.equal(error.code,'23503');}
 assert.equal((await repo.existing(c,'BR','test-model'))[0].name,'Batman');
 await repo.exclusive(async()=>{const lock=await other.query('SELECT pg_try_advisory_lock(741239810) AS locked');assert.equal(lock.rows[0].locked,false);});
 const lock=await other.query('SELECT pg_try_advisory_lock(741239810) AS locked');assert.equal(lock.rows[0].locked,true);await other.query('SELECT pg_advisory_unlock(741239810)');
 await repo.record(c,'BR','test-model',.75,{generated:1},{inputTokens:10,outputTokens:0,totalTokens:10},{inputTokens:2,outputTokens:3,totalTokens:5});
 const run=(await c.query('SELECT * FROM youtube_semantic_processing_runs ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(run.embedding_usage.totalTokens,10);assert.equal(run.naming_usage.totalTokens,5);
 console.log('PASS semantic persistence: migrations, model/hash cache, vector arrays, atomic publication/FK rollback, identity, advisory lock/release, separate usage');
 }finally{await c.end();await other.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
