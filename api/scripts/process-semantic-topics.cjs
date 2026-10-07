if (process.argv.includes('--canonical-sample')) {
  require('./process-canonical-topics.cjs');
} else {
const { Client }=require('pg');const { writeFileSync, readFileSync }=require('node:fs');
process.loadEnvFile('.env');
const { SemanticTopicsRepository }=require('../dist/trends/semantic/semantic-topics.repository');
const { SemanticTopicsProcessor }=require('../dist/trends/semantic/semantic-topics.processor');
const { SemanticTextBuilder }=require('../dist/trends/semantic/semantic-text.builder');
const { TopicEntitiesService }=require('../dist/trends/semantic/topic-entities.service');
const { TopicNamingService }=require('../dist/trends/semantic/topic-naming.service');
const { TopicClusteringService }=require('../dist/trends/topic-clustering.service');
const { OpenAiLlmProvider }=require('../dist/src/ai/openai-llm.provider');
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 try {await c.connect();
 const config={get:key=>process.env[key]};
 const repository=new SemanticTopicsRepository({withClient:work=>work(c)}),builder=new SemanticTextBuilder(),entities=new TopicEntitiesService(),clustering=new TopicClusteringService(),provider=new OpenAiLlmProvider(config),naming=new TopicNamingService(entities,provider,config);
 const processor=new SemanticTopicsProcessor(repository,builder,entities,clustering,naming,provider,config);
 const summaries=await processor.process();
 if(!summaries)throw new Error('Processamento não concluído ou outro worker está ativo');
 const videos=await repository.videos(c,'BR'),cache=new Map((await repository.embeddings(c,videos.map(v=>v.id),processor.settings().model)).map(e=>[e.video_id,e]));
 const semantic=videos.filter(v=>cache.get(v.id)?.source_hash===builder.build(v).hash).map(video=>({video,vector:cache.get(video.id).vector,sourceHash:cache.get(video.id).source_hash,entities:entities.extract(video).map(e=>e.name),specificEntities:entities.extract(video).filter(e=>e.specific).map(e=>e.name)}));
 const thresholds=[0.60,0.65,0.70,0.72,0.75,0.80].map(threshold=>{const clusters=clustering.groupSemantically(semantic,threshold);return {threshold,distribution:clustering.diagnostics(clusters.map(c=>c.members.length)),groups:clusters.filter(c=>c.members.length>1).map(c=>({titles:c.members.map(m=>m.video.snippet.title),entities:entities.dominant(c.members.map(m=>m.video))}))};});
 const topClusters=(await c.query(`SELECT t.id,t.name,t.keywords,count(m.video_id)::int AS count,array_agg(v.video->'snippet'->>'title' ORDER BY m.video_id) AS titles FROM youtube_semantic_topics t JOIN youtube_video_topics m ON m.topic_id=t.id JOIN youtube_videos v ON v.id=m.video_id WHERE m.region_code='BR' GROUP BY t.id ORDER BY count(*) DESC,t.name LIMIT 10`)).rows;
 const report={generatedAt:new Date().toISOString(),settings:processor.settings(),summaries,thresholds,topClusters};
 writeFileSync('reports/topics-after.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({settings:report.settings,summaries,thresholds:thresholds.map(({threshold,distribution})=>({threshold,...distribution})),topClusters}));
 }finally{await c.end();}
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});

}
