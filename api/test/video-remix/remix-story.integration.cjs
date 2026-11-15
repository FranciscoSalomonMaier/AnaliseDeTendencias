const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { randomUUID } = require('node:crypto'),
  { Client } = require('pg'),
  { spawnSync } = require('node:child_process');
const Loader = require('node:module'),
  original = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (name) => require('../../dist/src/' + name);
const { Module, HttpException } = require('@nestjs/common'),
  { NestFactory, APP_GUARD } = require('@nestjs/core'),
  { ConfigService } = require('@nestjs/config'),
  { MulterModule } = require('@nestjs/platform-express'),
  { diskStorage } = require('multer');
const { PostgresDatabaseService } = load('database/postgres-database.service'),
  { ContentAccessGuard, ContentAccessController } = load(
    'content-publication/content-access',
  ),
  { LocalStorageProvider } = load('content-assets/local-storage.provider'),
  { MediaProcess } = load('video-render/media-process'),
  { VideoRemixRepository } = load('video-remix/video-remix.repository'),
  { VideoRemixService } = load('video-remix/video-remix.service'),
  { VideoRemixController } = load('video-remix/video-remix.controller'),
  { RemixImportController } = load('video-remix/remix-import.controller'),
  { RemixImportService } = load('video-remix/remix-import.service'),
  { RemixImportSettings } = load('video-remix/remix-import.settings'),
  { RemixFilesService } = load('video-remix/remix-files.service'),
  { RemixVideoValidator } = load('video-remix/remix-video.validator'),
  { RemixUploadGuard } = load('video-remix/remix-upload.interceptor'),
  { RemixDiscoveryService } = load('video-remix/remix-discovery.service'),
  { YouTubeDiscoveryProvider } = load('video-remix/youtube-discovery.provider');
const video = (id) => ({
  id,
  snippet: {
    title: 'Vídeo ' + id,
    description: 'Vídeo de teste sobre GTA.',
    channelId: 'UCfixture',
    channelTitle: 'Canal de teste',
    publishedAt: '2026-11-01T00:00:00Z',
    thumbnails: {
      medium: { url: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' },
    },
  },
  contentDetails: { duration: 'PT2M30S' },
  statistics: { viewCount: '12345' },
  status: {
    privacyStatus: 'public',
    license: 'creativeCommon',
    uploadStatus: 'processed',
  },
});
(async () => {
  assert.ok(
    process.env.CONTENT_TEST_DATABASE_URL,
    'Disposable database required',
  );
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'remix_story_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-remix-story-');
  let db, app;
  try {
    const values = {
      DATABASE_URL: url.toString(),
      TTS_OUTPUT_FORMAT:'wav',
      OPENAI_API_KEY:'mock-not-real', VIDEO_REMIX_ANALYSIS_MODEL:'mock-vision',
      VIDEO_REMIX_ANALYSIS_TEMP_DIR:join(root,'analysis-tmp'),
      VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS:'2', VIDEO_REMIX_ECONOMIC_MAX_SEGMENTS:'4', VIDEO_REMIX_ECONOMIC_MAX_FRAMES:'12', VIDEO_REMIX_MIN_SEGMENT_SECONDS:'0.5',
      CONTENT_ACCESS_KEY: 'remix-import-test-key',
      CONTENT_OWNER_ID: 'owner-a',
      CONTENT_STORAGE_PATH: join(root, 'storage'),
      VIDEO_REMIX_UPLOAD_MAX_MB: '1',
      VIDEO_REMIX_UPLOAD_TEMP_DIR: join(root, 'tmp'),
      FRONTEND_URL: 'http://127.0.0.1:33873',
    };
    const config = { get: (k) => values[k] };
    db = new PostgresDatabaseService(config);
    db.pool.on("error",e=>console.error("Test database pool:",e.code));
    for (const name of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-8])_.*\.sql$/.test(f))
      .sort()) {
      const sql = fs.readFileSync(resolve('migrations', name), 'utf8');
      await db.query(sql);
      await db.query(sql);
    }
    const settings = new RemixImportSettings(config);
    fs.mkdirSync(settings.tempDir, { recursive: true });
    const storage = new LocalStorageProvider(config),
      repo = new VideoRemixRepository(db),
      files = new RemixFilesService(repo, storage, settings),
      projects = new VideoRemixService(config, repo, storage, files),
      validator = new RemixVideoValidator(settings, new MediaProcess());
    const calls = [];
    let apiError = false,
      missing = false;
    const youtube = {
      discoveryRequest: async (resource, params) => {
        calls.push({ resource, params });
        if (apiError)
          throw new HttpException('Quota da YouTube Data API esgotada.', 429);
        if (resource === 'search')
          return {
            items: [
              {
                id: {
                  videoId: params.pageToken ? 'fixture0002' : 'fixture0001',
                },
                snippet: video('fixture0001').snippet,
              },
            ],
            nextPageToken: params.pageToken ? undefined : 'next',
            prevPageToken: params.pageToken ? 'previous' : undefined,
          };
        return { items: missing ? [] : params.id.split(',').map(video) };
      },
    };
    const discovery = new RemixDiscoveryService(
        repo,
        new YouTubeDiscoveryProvider(youtube),
        config,
      ),
      service = new RemixImportService(
        projects,
        repo,
        discovery,
        files,
        validator,
      );
    const {RemixAnalysisSettings}=load('video-remix/remix-analysis.settings'),
      {RemixAnalysisService}=load('video-remix/remix-analysis.service'),
      {RemixAnalysisMedia}=load('video-remix/remix-analysis.media'),
      {RemixAnalysisWorker}=load('video-remix/remix-analysis.worker'),
      {RemixAnalysisController}=load('video-remix/remix-analysis.controller'),
      {VideoSceneAnalysisService}=load('video-remix/video-scene-analysis.service');
    const analysisSettings=new RemixAnalysisSettings(config),analysis=new RemixAnalysisService(projects,repo,files,analysisSettings),media=new RemixAnalysisMedia(analysisSettings,new MediaProcess());
    let aiCalls=0,failures=0,invalid=false,hold=false;
    const llm={generateStructuredOutput:async req=>{
      aiCalls++;if(failures-->0)throw new HttpException('Transient mock',503);
      if(hold){await new Promise((resolve,reject)=>{req.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true});});}
      const input=JSON.parse(req.userPrompt);
      const data=req.schemaName==='remix_sequences'?{sequences:[{sceneIds:input.scenes.slice(0,2).map(s=>s.id),description:'Sequência de cores sintéticas',justification:'Continuidade temporal',evidence:'INFERRED',relevance:60,confidence:.7}]}:{description:'Frame sintético colorido; nenhum easter egg verificável.',narrativeRole:'OTHER',environment:'Cenário sintético',characters:[],objects:['Cor'],actions:[],events:[],visibleText:[],changes:'Mudança de cor',keywords:['cor'],uncertainty:'Não é gameplay.',confidence:.99,relevance:invalid?110:5,justification:'Não há ovo de Páscoa visível.'};
      return {data,model:'mock-vision',provider:'mock',usage:{inputTokens:100,outputTokens:50,totalTokens:150}};
    }};
    const worker=new RemixAnalysisWorker(analysis,media,new VideoSceneAnalysisService(llm));
    const {RemixStoryService}=load('video-remix/remix-story.service'),{RemixStorySettings}=load('video-remix/remix-story.settings'),{RemixStoryWorker}=load('video-remix/remix-story.worker'),{RemixStoryController}=load('video-remix/remix-story.controller'),{RemixNarrativePlanner}=load('video-remix/remix-narrative-planner'),{RemixScriptAiService}=load('video-remix/remix-script-ai.service'),{RemixVoiceService}=load('video-remix/remix-voice.service'),{TtsSettings}=load('content-narration/tts-settings'),{AudioFileValidator}=load('content-narration/audio-file.validator');
    let textCalls=0,ttsCalls=0,ttsFailure=false,badScript=false,ttsHold=null;
    const requests=[];
    const storyLlm={generateStructuredOutput:async req=>{textCalls++;const input=JSON.parse(req.userPrompt);let data;
      if(req.schemaName==='remix_script_support')data={status:input.segment.text.includes('unicórnio')?'UNSUPPORTED':input.segment.text.includes('Talvez')?'PARTIALLY_SUPPORTED':'SUPPORTED',reason:input.segment.text.includes('unicórnio')?'Não há unicórnio visível.':'Os frames mostram cores sintéticas.',suggestedRewrite:input.segment.text.includes('unicórnio')?'O vídeo mostra uma cor.':''};
      else if(req.schemaName==='remix_script_segment')data={kind:input.segmentToRewrite.kind,text:'Este trecho apresenta uma cor visível.',candidateIds:input.segmentToRewrite.candidateIds,notes:'Revisão individual.'};
      else data={plan:{structure:'Introdução e detalhe visível.',visualGaps:['Não há gameplay nem ovo verificável nesta fixture.']},segments:input.evidence.slice(0,2).map((e,i)=>({kind:i?'DEVELOPMENT':'HOOK',text:badScript?'Um unicórnio atravessa uma parede.':i?'Agora, aparece outra cor na imagem.':'Neste trecho, vemos uma cor azul.',candidateIds:[e.id],notes:'Somente evidências da fixture.'}))};
      return {data,provider:'mock',model:'mock-vision',usage:{inputTokens:100,outputTokens:50,totalTokens:150}};
    }};
    const tts={generateSpeech:async req=>{ttsCalls++;requests.push(req);if(ttsFailure)throw new HttpException('Mock failure',503);if(ttsHold)await ttsHold(req.signal);return {audio:fs.readFileSync(join(root,'speech.wav')),mimeType:'audio/wav',provider:'mock',model:'mock-tts',voice:req.settings.voice,metadata:{characterCount:req.text.length},usage:null};}};
    const ttsSettings=new TtsSettings(config),storySettings=new RemixStorySettings(config,ttsSettings),voice=new RemixVoiceService(tts,new AudioFileValidator(ttsSettings),new MediaProcess(),settings,storySettings),story=new RemixStoryService(analysis,new RemixNarrativePlanner(analysis),storySettings,voice),storyWorker=new RemixStoryWorker(story,new RemixScriptAiService(storyLlm,storage,storySettings));
    class TestModule {}
    Module({
      imports: [
        MulterModule.register({
          storage: diskStorage({
            destination: settings.tempDir,
            filename: (req, _file, cb) => {
              const filename = 'remix-' + randomUUID();
              req.once('aborted', () =>
                fs.promises
                  .unlink(join(settings.tempDir, filename))
                  .catch(() => {}),
              );
              cb(null, filename);
            },
          }),
          limits: {
            files: 1,
            fileSize: settings.maxBytes,
            fields: 4,
            fieldSize: 10000,
            parts: 5,
          },
        }),
      ],
      controllers: [
        RemixStoryController,
        RemixAnalysisController,
        VideoRemixController,
        RemixImportController,
        ContentAccessController,
      ],
      providers: [
        { provide: RemixStoryService,useValue:story },
        { provide: RemixAnalysisService,useValue:analysis },
        { provide: ConfigService, useValue: config },
        { provide: VideoRemixRepository, useValue: repo },
        { provide: VideoRemixService, useValue: projects },
        { provide: RemixImportService, useValue: service },
        { provide: RemixFilesService, useValue: files },
        { provide: RemixImportSettings, useValue: settings },
        RemixUploadGuard,
        { provide: APP_GUARD, useValue: new ContentAccessGuard(config, db) },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors({ origin: values.FRONTEND_URL, credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = { Authorization: 'Bearer ' + values.CONTENT_ACCESS_KEY };
    const request = async (path, method = 'GET', body, auth = true) => {
      const r = await fetch(base + '/video-remix' + path, {
        method,
        headers: {
          ...(auth ? headers : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    const create = async (mode = 'SINGLE_SOURCE') =>
      (
        await request('/projects', 'POST', {
          title: 'Importação de teste',
          topic: 'GTA Easter Eggs',
          description: '',
          mode,
          narrationLanguage: 'pt-BR',
          targetDurationSeconds: 60,
          aspectRatio: '9:16',
        })
      ).data;
    const rights = {
      authorization: 'AUTHORIZED',
      userDeclaredRights: true,
      author: 'Titular',
      licenseType: 'Autorização específica',
      evidence: 'Permissão registrada no contrato de teste.',
      notes: 'Fixture local.',
    };
    const ffmpeg = require('ffmpeg-static');
    const fixtures = {};
    for (const [ext, codec, mime] of [
      ['mp4', 'libx264', 'video/mp4'],
      ['mov', 'libx264', 'video/quicktime'],
      ['webm', 'libvpx-vp9', 'video/webm'],
      ['mkv', 'libx264', 'video/x-matroska'],
    ]) {
      const path = join(root, 'input.' + ext);
      const r = spawnSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=96x64:r=24:d=2',
          '-f','lavfi','-i','color=c=yellow:s=96x64:r=24:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]',
          '-c:v',
          codec,
          '-threads',
          '1',
          path,
        ],
        { timeout: 30000 },
      );
      assert.equal(r.status, 0, String(r.stderr));
      fixtures[ext] = { path, mime, buffer: fs.readFileSync(path) };
    }
    async function upload(p, fixture, options = {}) {
      const form = new FormData();
      form.append('revision', String(p.revision));
      if (options.sourceId) form.append('sourceId', options.sourceId);
      form.append('rights', JSON.stringify(options.rights ?? rights));
      form.append(
        'file',
        new Blob([fixture.buffer], { type: options.mime ?? fixture.mime }),
        options.filename ?? 'uploaded.' + options.ext,
      );
      const r = await fetch(base + `/video-remix/projects/${p.id}/files`, {
        method: 'POST',
        headers: options.unauthorized ? {} : headers,
        body: form,
        signal: options.signal,
      });
      return { status: r.status, data: await r.json() };
    }
    const wav=spawnSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=3.25','-ac','1','-ar','24000','-c:a','pcm_s16le',join(root,'speech.wav')],{timeout:30000});assert.equal(wav.status,0,String(wav.stderr));
    const userConfig={language:'pt-BR',style:'CURIOSIDADE',targetDuration:35,voice:'cedar',speed:1};
    const draftSegments=s=>s.segments.map(x=>({id:x.id,kind:x.kind,text:x.text,candidateIds:x.candidate_ids,notes:x.notes}));
    async function prepare(mode='SINGLE_SOURCE'){
      let p=await create(mode);for(let i=0;i<(mode==='MULTI_SOURCE'?2:1);i++){assert.equal((await upload(p,fixtures.mp4,{ext:'mp4'})).status,201);p=(await request(`/projects/${p.id}`)).data;}
      assert.equal((await request(`/projects/${p.id}/story/scripts`,'POST',{confirm:true,config:userConfig})).status,400,'no selected evidence');
      const start=await request(`/projects/${p.id}/analysis`,'POST',{profile:'ECONOMIC',confirm:true});for(const job of start.data.items){await worker.tick();const result=(await request(`/projects/${p.id}/analysis/${job.id}`)).data;assert.equal(result.analysis.status,'COMPLETED');const targets=result.candidates.filter(c=>c.evidence_type==='OBSERVED'&&c.scene_ids.length===1).slice(0,mode==='MULTI_SOURCE'?1:2);for(const c of targets)assert.equal((await request(`/projects/${p.id}/analysis/${job.id}/candidates/${c.id}`,'PATCH',{selected:true,start:c.start_seconds,end:c.end_seconds,revision:c.revision})).status,200);}
      return (await request(`/projects/${p.id}`)).data;
    }
    let p=await prepare(),prefix=`/projects/${p.id}/story`;
    assert.equal((await request(prefix+'/options','GET',null,false)).status,401);assert.equal((await request(prefix+'/options')).data.estimatedUsd,null);
    const payload={confirm:true,config:userConfig};const [first,duplicate]=await Promise.all([request(prefix+'/scripts','POST',payload),request(prefix+'/scripts','POST',payload)]);assert.equal(first.status,201);assert.equal(first.data.id,duplicate.data.id);assert.equal(textCalls,0);
    await storyWorker.tick();let jobs=(await request(prefix+'/jobs')).data.items;assert.equal(jobs[0].status,'COMPLETED',JSON.stringify(jobs));let script=(await request(prefix+'/scripts/'+jobs[0].result_id)).data;assert.equal(script.segments.length,2);assert.equal(script.status,'VALIDATED');assert.ok(script.segments.every(s=>s.references.length&&s.validation.status==='SUPPORTED'));assert.ok(!JSON.stringify(script).includes('storage_key'));assert.ok(!JSON.stringify(script).includes('internal.jpg'));
    const get=async()=>script=(await request(prefix+'/scripts/'+script.id)).data;
    const run=async(operation,extra={})=>{const r=await request(prefix+`/scripts/${script.id}/${operation}`,'POST',{confirm:true,revision:script.revision,...extra});assert.equal(r.status,201,JSON.stringify(r));await storyWorker.tick();await get();return r.data;};
    const save=async(segments,config)=>{const r=await request(prefix+`/scripts/${script.id}`,'PATCH',{revision:script.revision,...(segments?{segments}:{}),...(config?{config}:{})});assert.equal(r.status,200,JSON.stringify(r));script=r.data;return script;};
    await run('narrate',{mode:'SEGMENTED'});assert.equal(ttsCalls,2);assert.ok(script.segments.every(s=>Math.abs(s.narration.duration_seconds-3.25)<.02));assert.ok(script.segments.every(s=>s.sync.status==='AUDIO_LONGER'));assert.ok(Math.abs(script.actualSeconds-6.5)<.05);
    let audio=script.segments[0].narration;let audioRoute=prefix+`/scripts/${script.id}/audio/${audio.id}`;assert.equal((await fetch(base+'/video-remix'+audioRoute)).status,401);let response=await fetch(base+'/video-remix'+audioRoute,{headers:{...headers,Range:'bytes=0-15'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,16);
    await run('narrate',{mode:'SEGMENTED'});assert.equal(ttsCalls,2,'identical audio reused');
    const savedSecond=script.segments[1].narration.id;let edits=draftSegments(script);edits[0].text='Um unicórnio atravessa uma parede.';await save(edits);assert.equal(script.segments[0].narration,null);assert.equal(script.segments[1].narration.id,savedSecond);assert.equal(script.segments[0].validation.status,'PENDING');assert.equal((await request(prefix+`/scripts/${script.id}/narrate`,'POST',{confirm:true,revision:script.revision})).status,400);
    assert.equal((await request(prefix+`/scripts/${script.id}`,'PATCH',{revision:script.revision,segments:edits.map(e=>({...e,validation:'SUPPORTED'}))})).status,400,'no user override');
    await run('validate');assert.equal(script.segments[0].validation.status,'UNSUPPORTED');assert.ok(script.segments[0].validation.suggestedRewrite);assert.equal((await request(prefix+`/scripts/${script.id}/narrate`,'POST',{confirm:true,revision:script.revision})).status,400);
    edits=draftSegments(script);edits[0].text='Talvez haja uma passagem secreta.';await save(edits);await run('validate');assert.equal(script.segments[0].validation.status,'PARTIALLY_SUPPORTED');
    edits=draftSegments(script);edits[0].text='Neste trecho, vemos uma cor azul.';await save(edits);await run('validate');await run('narrate',{segmentId:script.segments[0].id});assert.equal(ttsCalls,2,'restored identical text reuses cache');
    const secondText=script.segments[1].text;await run('regenerate',{segmentId:script.segments[0].id});assert.equal(script.segments[1].text,secondText);assert.equal(script.segments[0].narration,null);assert.equal(script.segments[1].narration.id,savedSecond);
    edits=draftSegments(script).reverse();await save(edits);assert.equal(script.segments[0].text,secondText);assert.equal(script.segments[0].narration.id,savedSecond);await run('narrate',{mode:'FULL'});assert.ok(script.fullNarration);assert.ok(Math.abs(script.fullNarration.duration_seconds-3.25)<.02);
    const oldAudio=script.fullNarration.id;await save(undefined,{...script.config,voice:'nova',speed:1.1,targetDuration:5});assert.equal(script.fullNarration,null);assert.ok(script.segments.every(s=>s.narration===null));assert.equal((await fetch(base+'/video-remix'+prefix+`/scripts/${script.id}/audio/${oldAudio}`,{headers})).status,404);await run('narrate',{mode:'SEGMENTED'});assert.ok(script.differenceSeconds>0);assert.ok(requests.slice(-2).every(r=>r.settings.voice==='nova'&&r.settings.speed===1.1));
    const staleRevision=script.revision-1;assert.equal((await request(prefix+`/scripts/${script.id}`,'PATCH',{revision:staleRevision,segments:draftSegments(script)})).status,409);
    // A pending TTS cannot overwrite a newer manual edit.
    await save(undefined,{...script.config,speed:1.15});let entered,release;const enteredPromise=new Promise(r=>entered=r);ttsHold=async()=>{entered();await new Promise(r=>release=r);};let task=(await request(prefix+`/scripts/${script.id}/narrate`,'POST',{confirm:true,revision:script.revision,segmentId:script.segments[0].id})).data;const processing=storyWorker.tick();await enteredPromise;edits=draftSegments(script);edits[0].text='O texto foi revisado durante a geração.';await save(edits);release();await processing;ttsHold=null;await get();assert.equal(script.segments[0].text,edits[0].text);assert.equal(script.segments[0].narration,null);assert.equal((await request(prefix+'/jobs')).data.items.find(j=>j.id===task.id).status,'FAILED');
    await run('validate');ttsFailure=true;task=await run('narrate',{segmentId:script.segments[0].id});ttsFailure=false;assert.equal((await request(prefix+'/jobs')).data.items.find(j=>j.id===task.id).status,'FAILED');
    task=(await request(prefix+`/scripts/${script.id}/narrate`,'POST',{confirm:true,revision:script.revision,segmentId:script.segments[0].id})).data;const before=ttsCalls;await request(prefix+`/jobs/${task.id}/cancel`,'POST',{});await storyWorker.tick();assert.equal(ttsCalls,before);assert.equal((await request(prefix+'/jobs')).data.items.find(j=>j.id===task.id).status,'CANCELLED');
    badScript=true;const bad=(await request(prefix+'/scripts','POST',{confirm:true,config:{...userConfig,style:'EXPLICATIVO'}})).data;await storyWorker.tick();badScript=false;const badJob=(await request(prefix+'/jobs')).data.items.find(j=>j.id===bad.id);assert.equal(badJob.status,'COMPLETED');assert.equal((await request(prefix+'/scripts/'+badJob.result_id)).data.status,'NEEDS_REVIEW');
    values.CONTENT_OWNER_ID='another-owner';assert.equal((await request(prefix+'/scripts')).status,404);values.CONTENT_OWNER_ID='owner-a';
    values.VIDEO_REMIX_SCRIPT_MAX_JOBS_PER_PROJECT='1';assert.equal((await request(prefix+'/scripts','POST',{confirm:true,config:{...userConfig,style:'DINAMICO'}})).status,409);delete values.VIDEO_REMIX_SCRIPT_MAX_JOBS_PER_PROJECT;
    assert.ok((await db.query('SELECT 1 FROM video_remix_script_revisions WHERE script_id=$1',[script.id])).rowCount>3,'manual revisions preserved');
    // Single/multi workflows use evidence from the correct source, not a random file.
    const multi=await prepare('MULTI_SOURCE');const multiPrefix=`/projects/${multi.id}/story`;const multiJob=(await request(multiPrefix+'/scripts','POST',payload)).data;await storyWorker.tick();const multiDone=(await request(multiPrefix+'/jobs')).data.items.find(j=>j.id===multiJob.id);assert.equal(multiDone.status,'COMPLETED');const multiScript=(await request(multiPrefix+'/scripts/'+multiDone.result_id)).data;assert.equal(new Set(multiScript.segments.flatMap(s=>s.references.map(r=>r.sourceId))).size,2);
    // Browser exercises user editing/consent and real audio files with mocked providers.
    await require('./remix-story.browser.cjs')({api:base,key:values.CONTENT_ACCESS_KEY,root,projectId:multi.id,run:()=>storyWorker.tick()});
    const key=(await db.query('SELECT storage_key FROM video_remix_narrations WHERE project_id=$1 LIMIT 1',[p.id])).rows[0].storage_key;p=(await request(`/projects/${p.id}`)).data;await projects.remove(p.id,{revision:p.revision,confirm:true});await files.clean();await assert.rejects(()=>storage.stat(key));
    fs.writeFileSync(join(root,'story-evidence.json'),JSON.stringify({passed:true,mockTextCalls:textCalls,mockTtsCalls:ttsCalls,paidAiCalls:0,formats:['wav'],migrationsTwice:true},null,2));
    console.log('PASS Remix script/narration: selected evidence, structured narrative, independent support validation, unsupported/partial gates, versions/manual edits/reordering/regeneration, real FFprobe audio duration, cache, full/segmented speech, synchronization, stale-job protection, TTS failure/cancel, ownership and cleanup; single/multi source. Evidence: '+root);
  }catch(e){console.error("Original integration failure:",e);throw e;}finally{await app?.close();await db?.onModuleDestroy();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
