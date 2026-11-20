// Real PostgreSQL + authenticated HTTP; no workers, media processing or paid providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {resolve,join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {Client,Pool}=require('pg');
const Loader=require('node:module'),original=Loader._resolveFilename;
Loader._resolveFilename=function(name,...args){return original.call(this,name.startsWith('src/')?resolve('dist',name):name,...args);};
const load=name=>require('../../dist/src/'+name);
const {Module}=require('@nestjs/common'),{NestFactory,APP_GUARD}=require('@nestjs/core');
const {MulterModule}=require('@nestjs/platform-express'),{ConfigService}=require('@nestjs/config');
const {ShortService}=load('short-creation/short.service'),{ShortSettings}=load('short-creation/short.settings');
const {ShortController,ShortUploadGuard,ShortMusicUploadInterceptor}=load('short-creation/short.controller');
const {ShortSoundtrackService}=load('short-creation/short-music.service');
const {shortUploadOptions}=load('short-creation/short.module');
const {ContentAccessGuard}=load('content-publication/content-access'),{PostgresDatabaseService}=load('database/postgres-database.service');
(async()=>{
 assert.ok(process.env.SHORT_TEST_DATABASE_URL,'Set SHORT_TEST_DATABASE_URL to a PostgreSQL test connection with CREATEDB.');
 const admin=new Client({connectionString:process.env.SHORT_TEST_DATABASE_URL,connectionTimeoutMillis:5000});await admin.connect();
 const name='short_classification_'+randomUUID().replaceAll('-','');await admin.query(`CREATE DATABASE "${name}"`);
 const url=new URL(process.env.SHORT_TEST_DATABASE_URL);url.pathname='/'+name;
 const root=fs.mkdtempSync('/tmp/trends-short-classification-');let app,pool;
 try{
  pool=new Pool({connectionString:url.toString()});const db={query:(...args)=>pool.query(...args),withClient:async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}}};
  for(const file of ['021_short_creation.sql','022_short_editing_references.sql','023_short_soundtrack.sql'])await db.query(fs.readFileSync(resolve('migrations',file),'utf8'));
  const values={CONTENT_ACCESS_KEY:'test-only-key',CONTENT_OWNER_ID:'owner-a',SHORT_CREATION_TEMP_DIR:join(root,'tmp')};const config={get:key=>values[key]},settings=new ShortSettings(config);
  const unexpected=()=>{throw Error('Unexpected external or file operation');};const storage={delete:unexpected,save:unexpected,read:unexpected},service=new ShortService(db,settings,storage,{validate:unexpected});
  class TestModule{};
  Module({imports:[MulterModule.register(await shortUploadOptions(config))],controllers:[ShortController],providers:[{provide:ShortService,useValue:service},{provide:ShortSoundtrackService,useValue:{upload:unexpected}},ShortUploadGuard,ShortMusicUploadInterceptor,{provide:ConfigService,useValue:config},{provide:PostgresDatabaseService,useValue:db},{provide:APP_GUARD,useClass:ContentAccessGuard}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:['error']});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  async function api(path,method='GET',body,status=200,auth=true){const response=await fetch(base+path,{method,headers:{Connection:'close',...(auth?{Authorization:'Bearer test-only-key'}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,status,method+' '+path+' '+JSON.stringify(result));return result;}
  await api('/shorts/options','GET',null,401,false);
  const options=await api('/shorts/options');const oldFields=['aiEnabled','voices','maxBytes','musicMaxBytes','musicMaxSeconds','maxFiles','maxDuration','scanSeconds','referenceMaxFiles','referenceMaxSeconds','referenceMaxFrames','editingFeatures'];for(const key of oldFields)assert.ok(key in options,key);
  assert.equal(options.classifications.version,1);assert.equal(options.classifications.usage,'EDITORIAL_INTENT_ONLY');assert.deepEqual([options.classifications.videoTypes.length,options.classifications.videoTopics.length,options.classifications.editingStyles.length],[5,5,8]);for(const list of [options.classifications.videoTypes,options.classifications.videoTopics,options.classifications.editingStyles])assert.ok(list.every(e=>e.available===false));
  const classification={version:1,videoType:'TOP_X',videoTopic:'HUMOR',editingStyle:'DYNAMIC'};
  const legacy=await api('/shorts','POST',{description:'Projeto anterior sem classificação',targetSeconds:30},201);assert.ok(!('classification' in legacy.data));
  let p=await api('/shorts','POST',{description:'Intenção editorial opcional',targetSeconds:45,classification},201);assert.deepEqual(p.data.classification,classification);assert.equal(p.step,1);assert.equal(p.data.script,undefined);assert.equal(p.data.editing,undefined);
  assert.deepEqual((await api('/shorts/'+p.id)).data.classification,classification);
  for(const invalid of [{...classification,videoType:'UNKNOWN'},{...classification,videoTopic:'DYNAMIC'},{...classification,editingStyle:'GAMING'},{...classification,version:2},null]){
   await api('/shorts/'+p.id,'PATCH',{revision:p.revision,classification:invalid},400);
   await api('/shorts','POST',{description:'Classificação inválida',targetSeconds:30,classification:invalid},400);
  }
  const sourceId=randomUUID(),refId=randomUUID();
  for(const [id,role]of [[sourceId,'SOURCE'],[refId,'REFERENCE']])await db.query('INSERT INTO short_files(id,project_id,original_name,storage_key,bytes,duration,width,height,fps,mime,role) VALUES($1,$2,$3,$4,3,4,320,180,30,$5,$6)',[id,p.id,role+'.mp4','shorts/'+p.id+'/'+role+'/'+id+'.mp4','video/mp4',role]);
  await db.query('INSERT INTO short_reference_analyses(file_id,project_id,cache_key,profile) VALUES($1,$2,$3,$4)',[refId,p.id,'existing-cache',{preserved:true}]);
  const existing={classification,script:{introduction:'I',development:'D',conclusion:'C'},scriptApproved:true,narrationText:'Áudio anterior',textApproved:true,audio:{key:'shorts/'+p.id+'/voice.wav',duration:4,bytes:3,mime:'audio/wav'},editing:{enabled:true,approved:true,profiles:[{fileId:refId}]},decorations:{segments:[],overlays:[],warnings:[],granularity:'SEGMENT'},plan:{clips:[{fileId:sourceId,start:0,end:4,description:'Original'}],semantic:false,notice:'Preservado'},planApproved:true,music:{key:'shorts/'+p.id+'/music.wav'},musicSettings:{volume:.15},output:{key:'shorts/'+p.id+'/final.mp4',duration:4,bytes:3,width:1080,height:1920,fps:30,createdAt:new Date().toISOString()}};
  await db.query("UPDATE short_projects SET data=$2,step=9,status='FAILED',error_message='Preservar diagnóstico' WHERE id=$1",[p.id,existing]);
  const filesBefore=(await db.query('SELECT * FROM short_files WHERE project_id=$1 ORDER BY id',[p.id])).rows;
  const selected={version:1,videoType:'VIBE',videoTopic:'GAMING',editingStyle:'ANALOG_HORROR'};
  p=await api('/shorts/'+p.id,'PATCH',{revision:p.revision,classification:selected});assert.deepEqual(p.data.classification,selected);assert.equal(p.step,9);assert.equal(p.status,'FAILED');assert.equal(p.error_message,'Preservar diagnóstico');
  const stored=(await db.query('SELECT data FROM short_projects WHERE id=$1',[p.id])).rows[0].data;assert.deepEqual(stored,{...existing,classification:selected,editorialReview:{version:1,configurationRevision:1,approvedRevision:null}});assert.deepEqual((await db.query('SELECT * FROM short_files WHERE project_id=$1 ORDER BY id',[p.id])).rows,filesBefore);assert.deepEqual((await db.query('SELECT profile FROM short_reference_analyses WHERE file_id=$1',[refId])).rows[0].profile,{preserved:true});
  await api('/shorts/'+p.id,'PATCH',{revision:p.revision-1,classification},409);
  values.CONTENT_OWNER_ID='owner-b';await api('/shorts/'+p.id,'GET',null,404);await api('/shorts/'+p.id,'PATCH',{revision:p.revision,classification},404);values.CONTENT_OWNER_ID='owner-a';
  assert.ok(!('classification' in (await api('/shorts/'+legacy.id)).data));
  for(const table of ['short_jobs','short_storage_cleanup'])assert.equal(Number((await db.query('SELECT count(*) n FROM '+table)).rows[0].n),0);
  console.log('PASS: classification catalogs, optional create/patch/get, unavailable intentions, invalid IDs/version/axes, old fields/projects, revision, authorization and preservation of all artifacts/status/approvals. No jobs or paid/file operations.');
 }finally{if(app)await app.close();if(pool)await pool.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
