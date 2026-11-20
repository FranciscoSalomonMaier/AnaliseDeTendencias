// Isolated database + synthetic media; every paid provider is mocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),{resolve,join}=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Pool,Client}=require('pg');
const Loader=require('node:module'),original=Loader._resolveFilename;
Loader._resolveFilename=function(name,...args){return original.call(this,name.startsWith('src/')?resolve('dist',name):name,...args);};
const load=name=>require('../../dist/src/'+name);
const {Module}=require('@nestjs/common'),{NestFactory,APP_GUARD}=require('@nestjs/core'),{ConfigService}=require('@nestjs/config'),{MulterModule}=require('@nestjs/platform-express'),{diskStorage}=require('multer');
const {ShortService}=load('short-creation/short.service'),{ShortSettings}=load('short-creation/short.settings'),{ShortController,ShortUploadGuard,ShortMusicUploadInterceptor}=load('short-creation/short.controller'),{ShortMedia}=load('short-creation/short.media'),{ShortWorker}=load('short-creation/short.worker');
const {ContentAccessGuard}=load('content-publication/content-access'),{PostgresDatabaseService}=load('database/postgres-database.service'),{LocalStorageProvider}=load('content-assets/local-storage.provider'),{RemixImportSettings}=load('video-remix/remix-import.settings'),{RemixVideoValidator}=load('video-remix/remix-video.validator'),{RemixAnalysisSettings}=load('video-remix/remix-analysis.settings'),{RemixAnalysisMedia}=load('video-remix/remix-analysis.media'),{VideoSceneAnalysisService}=load('video-remix/video-scene-analysis.service'),{RemixStorySettings}=load('video-remix/remix-story.settings'),{RemixVoiceService}=load('video-remix/remix-voice.service'),{TtsSettings}=load('content-narration/tts-settings'),{AudioFileValidator}=load('content-narration/audio-file.validator'),{RenderSettings}=load('video-render/render-settings'),{MediaProcess}=load('video-render/media-process');
function wav(seconds){const samples=44100*seconds,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(44100,24);buffer.writeUInt32LE(88200,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);return buffer;}
(async()=>{
 assert.ok(process.env.SHORT_TEST_DATABASE_URL,'Set SHORT_TEST_DATABASE_URL to a local PostgreSQL admin connection; a disposable database is created.');
 const admin=new Client({connectionString:process.env.SHORT_TEST_DATABASE_URL});await admin.connect();const name='short_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(process.env.SHORT_TEST_DATABASE_URL);url.pathname='/'+name;
 const root=fs.mkdtempSync('/tmp/trends-shorts-');let app,pool;
 try{
  pool=new Pool({connectionString:url.toString()});const db={query:(...args)=>pool.query(...args),withClient:async fn=>{const c=await pool.connect();try{return await fn(c);}finally{c.release();}}};
  const migration=fs.readFileSync(resolve('migrations/021_short_creation.sql'),'utf8');await db.query(migration);await db.query(migration);
  const oldId=randomUUID();await db.query("INSERT INTO short_projects(id,owner_id,title,description,target_seconds,step) VALUES($1,'test','old','old project',30,7)",[oldId]);
  const referenceMigration=fs.readFileSync(resolve('migrations/022_short_editing_references.sql'),'utf8');await db.query(referenceMigration);await db.query(referenceMigration);assert.equal((await db.query('SELECT step FROM short_projects WHERE id=$1',[oldId])).rows[0].step,8);const musicMigration=fs.readFileSync(resolve('migrations/023_short_soundtrack.sql'),'utf8');await db.query(musicMigration);await db.query(musicMigration);assert.equal((await db.query('SELECT step FROM short_projects WHERE id=$1',[oldId])).rows[0].step,9);await db.query('DELETE FROM short_projects WHERE id=$1',[oldId]);
  const values={CONTENT_OWNER_ID:'owner-a',CONTENT_ACCESS_KEY:'test-local-only',SHORT_CREATION_TEMP_DIR:join(root,'tmp'),CONTENT_STORAGE_PATH:join(root,'storage'),SHORT_CREATION_MAX_FILES:'3',SHORT_CREATION_MAX_SOURCE_SECONDS:'60',SHORT_CREATION_MAX_SCENES:'6',SHORT_CREATION_SCAN_SECONDS:'60',SHORT_CREATION_MODEL:'mock-vision',OPENAI_API_KEY:'mock-not-real',TTS_OUTPUT_FORMAT:'wav',VIDEO_REMIX_UPLOAD_TEMP_DIR:join(root,'voice-tmp'),VIDEO_REMIX_UPLOAD_MAX_MB:'16',SHORT_CREATION_UPLOAD_MAX_MB:'16',VIDEO_REMIX_DETECT_CUTS:'true',VIDEO_RENDER_MIN_FREE_MB:'1'};
  const config={get:key=>values[key]},settings=new ShortSettings(config),storage=new LocalStorageProvider(config),processMedia=new MediaProcess(),imports=new RemixImportSettings(config),validator=new RemixVideoValidator(imports,processMedia),analysisSettings=new RemixAnalysisSettings(config),analysis=new RemixAnalysisMedia(analysisSettings,processMedia),ttsSettings=new TtsSettings(config),storySettings=new RemixStorySettings(config,ttsSettings);
  let audioSeconds=4,paidCalls=0,failLlm=false;
  const llm={generateStructuredOutput:async r=>{paidCalls++;if(failLlm)throw Error('simulated failure');let data;
   if(r.schemaName==='short_script')data={introduction:'Observe estas imagens.',development:'As cores mudam entre os cenários.',conclusion:'Qual detalhe chamou sua atenção?'};
   else if(r.schemaName==='short_narration_text')data={text:'Observe estas imagens. As cores mudam entre os cenários. Qual detalhe chamou sua atenção?'};
   else {const body=JSON.parse(r.userPrompt);data={description:'Uma cena de cores em movimento.',narrativeRole:'DETAIL',environment:'Cores',characters:[],objects:[],actions:[],events:[],visibleText:[],changes:'',keywords:['cor'],uncertainty:'',confidence:0.9,relevance:90,justification:'Tema visual.'};assert.ok(body.segment);}
   return {data:r.schema.parse(data),usage:{inputTokens:1,outputTokens:1,totalTokens:2},provider:'mock',model:'mock'};
  }};
  const ttsRequests=[];
  const tts={generateSpeech:async request=>{ttsRequests.push(request);paidCalls++;return {audio:wav(Math.round(audioSeconds/request.settings.speed)),mimeType:'audio/wav',provider:'mock',model:'mock',voice:'cedar',metadata:{},usage:{characters:80}};}};
  const {ShortEditingReferenceAnalysisService}=load('short-creation/short-reference-analysis.service'),{ShortEditingEffectsService}=load('short-creation/short-editing-effects.service'),{SpeechAlignmentProvider}=load('content-subtitles/speech-alignment.provider');
  let alignCalls=0;const llmRequests=[];let failReference=false;const originalGenerate=llm.generateStructuredOutput;llm.generateStructuredOutput=async request=>{llmRequests.push(request);
   if(request.schemaName==='short_editing_reference'){paidCalls++;if(failReference)throw Error('Mock reference analysis failure');return {data:request.schema.parse({captions:{present:true,position:'BOTTOM',fontSize:54,bold:true,primaryColor:'#FFFFFF',highlightColor:'#FFFF00',outline:true,shadow:true,wordsPerGroup:3,highlightWord:true,animated:null},overlays:{present:true,position:'TOP',frequency:'MODERATE',types:['KEYWORD']},zoom:{mode:'IN',frequency:'OCCASIONAL'},transition:'FADE',confidence:0.9,unknown:['Entonação desconhecida.']}),usage:{inputTokens:10,outputTokens:10,totalTokens:20}};}
   if(request.schemaName==='short_text_overlays'){paidCalls++;assert.ok(!request.userPrompt.includes('CONTEUDO_REFERENCIA'));return {data:{items:[{text:'CORES EM MOVIMENTO',firstUnit:0,lastUnit:1}]},usage:{inputTokens:10,outputTokens:10,totalTokens:20}};}
   return originalGenerate(request);
  };
  const aligner={align:async request=>{alignCalls++;const tokens=request.referenceText?request.referenceText.split(/\s+/):Array.from({length:24},(_,i)=>i===0?'CONTEUDO_REFERENCIA':'referência');const count=tokens.length;const unit=request.durationSeconds/count;const words=tokens.map((text,i)=>({text,startSeconds:i*unit,endSeconds:(i+0.65)*unit}));return {text:tokens.join(' '),words,segments:[{text:tokens.join(' '),startSeconds:0,endSeconds:request.durationSeconds}],granularity:'WORD',provider:'mock',model:'mock'};}};
  const {ShortMusicRenderer,ShortMusicValidator,ShortSoundtrackService}=load('short-creation/short-music.service'),{AudioMixService}=load('content-audio/audio-mix.service');
  const voice=new RemixVoiceService(tts,new AudioFileValidator(ttsSettings),processMedia,imports,storySettings),vision=new VideoSceneAnalysisService(llm),renders=new RenderSettings(config),service=new ShortService(db,settings,storage,validator),musicRenderer=new ShortMusicRenderer(new AudioMixService(),processMedia,renders,storage),soundtrackService=new ShortSoundtrackService(service,new ShortMusicValidator(settings,processMedia,renders)),media=new ShortMedia(settings,renders,processMedia,storage,analysis,analysisSettings,vision,validator,musicRenderer),referenceAnalysis=new ShortEditingReferenceAnalysisService(service,media,llm,aligner,settings),effects=new ShortEditingEffectsService(aligner,storage,llm,settings),worker=new ShortWorker(service,media,llm,voice,referenceAnalysis,effects);
  // Compile the production module as well, without starting any background worker.
  const {Test}=require('@nestjs/testing');
  const {ConfigModule}=require('@nestjs/config');
  const {ShortModule,shortUploadOptions}=load('short-creation/short.module');
  const {LlmProvider}=load('ai/llm.provider');
  const {TtsProvider}=load('content-narration/tts.provider');
  const container=await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,ignoreEnvVars:true,load:[()=>values]}),ShortModule]})
    .overrideProvider(PostgresDatabaseService).useValue(db)
    .overrideProvider(LlmProvider).useValue(llm)
    .overrideProvider(TtsProvider).useValue(tts).overrideProvider(SpeechAlignmentProvider).useValue(aligner).compile();
  await container.close();
  fs.mkdirSync(settings.tempDir,{recursive:true});
  class TestModule{};Module({imports:[MulterModule.register(await shortUploadOptions(config))],controllers:[ShortController],providers:[{provide:ShortService,useValue:service},ShortUploadGuard,ShortMusicUploadInterceptor,{provide:ShortSoundtrackService,useValue:soundtrackService},{provide:ConfigService,useValue:config},{provide:PostgresDatabaseService,useValue:db},{provide:APP_GUARD,useClass:ContentAccessGuard}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:['error']});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  async function api(path,method='GET',body,expected=200,auth=true){const headers={Connection:'close',...(auth?{Authorization:'Bearer test-local-only'}:{})};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.equal(r.status,expected,method+' '+path+' '+await (r.status===expected?Promise.resolve(''):r.text()));return r.status===204?null:await r.json();}
  await api('/shorts','GET',null,401,false);assert.equal(paidCalls,0);
  await api('/shorts','POST',{description:'No',targetSeconds:120},400);
  let p=await api('/shorts','POST',{description:'Um Short sobre cores e movimentos.',targetSeconds:30},201);const id=p.id;assert.equal(p.step,1);
  await api('/shorts/'+id,'PATCH',{revision:p.revision,step:5},400);
  const save=async data=>p=await api('/shorts/'+id,'PATCH',{revision:p.revision,...data});
  const run=async(kind,semantic=false)=>{p=await api('/shorts/'+id+'/jobs','POST',{revision:p.revision,kind,semantic,confirm:true},201);await worker.tick();p=await api('/shorts/'+id);assert.notEqual(p.status,'FAILED',p.error_message);};
  await run('SCRIPT');assert.ok(p.data.script);assert.equal(p.data.scriptApproved,false);
  await save({script:{...p.data.script,conclusion:'Observe mais uma vez.'}});await save({approve:'SCRIPT'});assert.equal(p.step,2);
  const a=join(root,'a.mp4'),b=join(root,'b.webm');for(const [path,color,codec]of[[a,'red','libx264'],[b,'blue','libvpx-vp9']]){const r=spawnSync(renders.ffmpegPath,['-v','error','-nostdin','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30:d=${process.env.SHORT_REFERENCE_TEST?20:6}`,'-an','-c:v',codec,'-threads','1','-pix_fmt','yuv420p','-y',path]);assert.equal(r.status,0,r.stderr?.toString());}
  const originalHash=createHash('sha256').update(fs.readFileSync(a)).digest('hex');
  async function upload(path,rights=true,expected=201){const form=new FormData();form.append('rights',String(rights));form.append('file',new Blob([fs.readFileSync(path)],{type:path.endsWith('.webm')?'video/webm':'video/mp4'}),path.split('/').at(-1));const result=await api('/shorts/'+id+'/files','POST',form,expected);if(expected===201)p=result;return result;}
  await upload(a,false,400);
  const extraField=new FormData();extraField.append('rights','true');extraField.append('unexpected','value');extraField.append('file',new Blob([fs.readFileSync(a)],{type:'video/mp4'}),'a.mp4');await api('/shorts/'+id+'/files','POST',extraField,400);
  const extraFile=new FormData();extraFile.append('rights','true');extraFile.append('file',new Blob([fs.readFileSync(a)],{type:'video/mp4'}),'a.mp4');extraFile.append('file',new Blob([fs.readFileSync(a)],{type:'video/mp4'}),'b.mp4');await api('/shorts/'+id+'/files','POST',extraFile,400);
  await upload(a);assert.equal(p.files.length,1);assert.ok(!JSON.stringify(p).includes('storage_key'));
  values.CONTENT_OWNER_ID='owner-b';await api('/shorts/'+id,'GET',null,404);await api('/shorts/'+id+'/files/'+p.files[0].id,'GET',null,404);values.CONTENT_OWNER_ID='owner-a';
  await save({step:3});await save({skipReferences:true});assert.equal(p.step,4);await run('TEXT');assert.ok(p.data.narrationText);assert.equal(p.data.textApproved,false);
  await api('/shorts/'+id+'/jobs','POST',{revision:p.revision,kind:'AUDIO',confirm:true},400);
  await save({approve:'TEXT'});await run('AUDIO');assert.equal(p.data.audio.duration,4);assert.ok(p.data.audio.url);
  const countBefore=paidCalls;await save({step:6});await run('PLAN');assert.equal(paidCalls,countBefore);assert.equal(p.data.plan.semantic,false);assert.equal(p.data.plan.clips.length,1);
  await save({approve:'PLAN'});await run('RENDER');assert.equal(p.status,'COMPLETED');assert.equal(p.step,9);assert.equal(p.data.output.width,1080);assert.equal(p.data.output.height,1920);
  let download=await fetch(base+p.data.output.downloadUrl,{headers:{Authorization:'Bearer test-local-only'}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);const mp4=Buffer.from(await download.arrayBuffer());assert.equal(mp4.toString('ascii',4,8),'ftyp');
  const partial=await fetch(base+p.data.output.url,{headers:{Authorization:'Bearer test-local-only',Range:'bytes=0-31'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,32);
  const recovered=await api('/shorts/'+id);assert.equal(recovered.step,9);assert.equal(recovered.data.output.bytes,mp4.length);
  // Add a second original, regenerate audio, semantic plan and blurred final render.
  await save({step:2});await upload(b);assert.equal(p.files.length,2);assert.equal(p.data.plan,undefined);
  const mov=join(root,'third.mov');const movResult=spawnSync(renders.ffmpegPath,['-v','error','-nostdin','-i',a,'-c','copy','-y',mov]);assert.equal(movResult.status,0);
  const movForm=new FormData();movForm.append('rights','true');movForm.append('file',new Blob([fs.readFileSync(mov)],{type:'video/quicktime'}),'third.mov');p=await api('/shorts/'+id+'/files','POST',movForm,201);assert.equal(p.files.length,3);await upload(a,true,400);
  const movFile=p.files.find(f=>f.original_name==='third.mov');p=await api('/shorts/'+id+'/files/'+movFile.id,'DELETE');assert.equal(p.files.length,2);
  await save({step:5});audioSeconds=7;await run('AUDIO');await save({step:6});await run('PLAN',true);assert.equal(p.data.plan.semantic,true);assert.equal(new Set(p.data.plan.clips.map(c=>c.fileId)).size,2);
  await save({approve:'PLAN',framing:'BLUR'});await run('RENDER');assert.ok(Math.abs(p.data.output.duration-7)<0.35);
  assert.equal(createHash('sha256').update(await storage.read((await service.files(id))[0].storage_key)).digest('hex'),originalHash);
  const listed=await api('/shorts');assert.ok(listed.items.some(i=>i.id===id&&i.status==='COMPLETED'));
  if(process.env.SHORT_MUSIC_TEST)await require('./short-music.scenarios.cjs')({api,base,save,run,get:()=>p,set:value=>p=value,id,root,settings,renders,processMedia,storage,service,musicRenderer,values,fs,join,spawnSync,assert});
  if(process.env.SHORT_REFERENCE_TEST){
    audioSeconds=30;
    await save({step:5});await run('AUDIO');await save({step:6});await run('PLAN');const basicCount=p.data.plan.clips.length;
    await save({approve:'PLAN',framing:'CROP'});await run('RENDER');const shortA=await storage.read((await service.project(id)).data.output.key);assert.ok(Math.abs(p.data.output.duration-30)<0.35);
    await save({step:3});
    const refPath=join(root,'reference.mp4');const colors=['red','blue','red','green','blue','yellow','blue','red'];
    const graph=colors.map((color,i)=>`color=c=${color}:s=320x568:r=15:d=1[v${i}]`).join(';')+';'+colors.map((_,i)=>`[v${i}]`).join('')+'concat=n=8:v=1:a=0';
    const refGen=spawnSync(renders.ffmpegPath,['-v','error','-nostdin','-f','lavfi','-i',graph,'-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libx264','-threads','1','-c:a','aac','-shortest','-y',refPath]);assert.equal(refGen.status,0,refGen.stderr?.toString());
    async function referenceUpload(){const form=new FormData();form.append('rights','true');form.append('file',new Blob([fs.readFileSync(refPath)],{type:'video/mp4'}),'reference.mp4');p=await api('/shorts/'+id+'/references','POST',form,201);}
    await referenceUpload();await referenceUpload();assert.equal(p.files.length,2);assert.equal(p.references.length,2);assert.ok(p.references.every(r=>r.role==='REFERENCE'));
    values.CONTENT_OWNER_ID='owner-b';await api('/shorts/'+id+'/references/'+p.references[0].id,'GET',null,404);values.CONTENT_OWNER_ID='owner-a';
    await run('REFERENCES');assert.equal(p.data.editing.profiles.length,2);assert.equal(p.data.editing.profiles[1].cached,true);assert.equal(p.data.editing.config.wordsPerMinute,180);
    const beforeCache=paidCalls,alignBefore=alignCalls;await run('REFERENCES');assert.equal(paidCalls,beforeCache);assert.equal(alignCalls,alignBefore);
    const removed=p.references[1].id;p=await api('/shorts/'+id+'/references/'+removed,'DELETE');assert.equal(p.references.length,1);await referenceUpload();await run('REFERENCES');assert.equal(paidCalls,beforeCache);
    await save({editingConfig:{...p.data.editing.config,narrationStyle:'DYNAMIC',shotSeconds:2}});await save({approve:'EDITING'});await run('TEXT');
    const textRequest=llmRequests.filter(r=>r.schemaName==='short_narration_text').at(-1);assert.equal(JSON.parse(textRequest.userPrompt).approximateWords,90);assert.ok(!textRequest.userPrompt.includes('CONTEUDO_REFERENCIA'));
    await save({approve:'TEXT'});await run('AUDIO');assert.equal(ttsRequests.at(-1).settings.speed,1.2);assert.match(ttsRequests.at(-1).instructions,/dinâmico/);assert.equal(p.data.audio.duration,25);
    await save({step:6});await run('PLAN');assert.ok(p.data.plan.clips.length>basicCount);assert.ok(p.data.plan.clips.filter((c,i,a)=>i>0&&c.fileId!==a[i-1].fileId).length>1);assert.equal(p.data.decorations.granularity,'WORD');assert.ok(p.data.decorations.overlays.length>0);
    assert.ok(p.data.plan.clips.every(c=>p.files.some(f=>f.id===c.fileId)));assert.ok(!p.data.plan.clips.some(c=>p.references.some(f=>f.id===c.fileId)));
    await save({approve:'PLAN'});
    if(process.env.SHORT_REFERENCE_MUSIC_TEST){
      const musicPath=join(root,'independent-music.wav');const generated=spawnSync(renders.ffmpegPath,['-v','error','-f','lavfi','-i','sine=frequency=660:duration=2','-c:a','pcm_s16le','-y',musicPath]);assert.equal(generated.status,0);
      const form=new FormData();form.append('rights','true');form.append('revision',String(p.revision));form.append('file',new Blob([fs.readFileSync(musicPath)],{type:'audio/wav'}),'independent-music.wav');p=await api('/shorts/'+id+'/music','POST',form,201);
    }
    await run('RENDER');const shortB=await storage.read((await service.project(id)).data.output.key);assert.notDeepEqual(shortA,shortB);assert.ok(Math.abs(p.data.output.duration-25)<0.35);
    if(process.env.SHORT_REFERENCE_ARTIFACT_DIR){fs.mkdirSync(process.env.SHORT_REFERENCE_ARTIFACT_DIR,{recursive:true});fs.writeFileSync(join(process.env.SHORT_REFERENCE_ARTIFACT_DIR,'short-a-without-references.mp4'),shortA);fs.writeFileSync(join(process.env.SHORT_REFERENCE_ARTIFACT_DIR,'short-b-with-references.mp4'),shortB);}
    console.log('PASS: comparação A/B real: A=30s sem referências; B=25s com velocidade 1.2, mais cortes, ASS/destaques reais, textos, zoom/fades; nenhuma fonte visual de referência na montagem.');
    await save({step:3});await save({skipReferences:true});assert.equal(p.data.editing.enabled,false);assert.equal(p.data.audio,null);
    await save({step:3,referenceFeatures:['captions']});failReference=true;
    await api('/shorts/'+id+'/jobs','POST',{revision:p.revision,kind:'REFERENCES',confirm:true},201);await worker.tick();p=await api('/shorts/'+id);assert.equal(p.status,'FAILED');assert.equal(p.references.length,2);
    failReference=false;await save({skipReferences:true});assert.equal(p.step,4);assert.equal(p.data.editing.enabled,false);

  }
  await save({step:4});await save({narrationText:'Texto editado e ainda não aprovado.'});assert.equal(p.data.textApproved,false);assert.equal(p.data.audio,null);assert.equal(p.data.output,null);await save({approve:'TEXT'});
  failLlm=true;await api('/shorts/'+id+'/jobs','POST',{revision:p.revision,kind:'TEXT',confirm:true},201);await worker.tick();p=await api('/shorts/'+id);assert.equal(p.status,'FAILED');assert.ok(p.data.narrationText);assert.ok(p.error_message);failLlm=false;
  await api('/shorts/'+id,'DELETE');await api('/shorts/'+id,'GET',null,404);assert.ok(Number((await db.query('SELECT count(*) n FROM short_storage_cleanup')).rows[0].n)>0);
  assert.equal(fs.readdirSync(settings.tempDir).length,0);
  await db.query("UPDATE short_storage_cleanup SET created_at=NOW()-INTERVAL '2 hours'");await worker.tick();assert.equal(Number((await db.query('SELECT count(*) n FROM short_storage_cleanup')).rows[0].n),0);
  console.log('PASS: 17 áreas do fluxo Criar Short; PostgreSQL isolado, upload MP4/WebM, FFmpeg real, render de um e vários vídeos, crop/blur, streaming, recuperação, autorização, invalidação e falhas. Serviços pagos simulados.');
 }finally{if(app)await app.close();if(pool)await pool.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
