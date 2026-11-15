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
  const name = 'remix_analysis_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-remix-analysis-');
  let db, app;
  try {
    const values = {
      DATABASE_URL: url.toString(),
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
    for (const name of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-7])_.*\.sql$/.test(f))
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
        RemixAnalysisController,
        VideoRemixController,
        RemixImportController,
        ContentAccessController,
      ],
      providers: [
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
    let p=await create();let uploaded=await upload(p,fixtures.mp4,{ext:'mp4'});assert.equal(uploaded.status,201);p=(await request(`/projects/${p.id}`)).data;
    const path=`/projects/${p.id}/analysis`,source=p.sources[0],body={profile:'ECONOMIC',sourceId:source.id,confirm:true};
    assert.equal((await request(path,'GET',null,false)).status,401);
    let estimate=await request(path+'/estimate','POST',{profile:'ECONOMIC'});assert.equal(estimate.status,201);assert.equal(estimate.data.estimatedUpperUsd,null);assert.equal(aiCalls,0);
    const [a,b]=await Promise.all([request(path,'POST',body),request(path,'POST',body)]);assert.equal(a.status,201);assert.equal(a.data.items[0].id,b.data.items[0].id);const id=a.data.items[0].id;
    assert.equal((await request(path)).data.items[0].status,'QUEUED');assert.equal(aiCalls,0);
    const abort=new AbortController();const meta=await media.metadata(fixtures.mp4.path,abort.signal);assert.equal(meta.hasAudio,false);assert.equal(meta.width,96);assert.equal(meta.duration,4);
    const cuts=await media.cuts(fixtures.mp4.path,4,analysisSettings.profile('ECONOMIC'),abort.signal);assert.ok(cuts.some(t=>Math.abs(t-2)<.1),'real scene cut detected at 2s');
    const continuous=join(root,'continuous.mp4');const continuousResult=spawnSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x64:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-threads','1','-shortest',continuous],{timeout:30000});assert.equal(continuousResult.status,0,String(continuousResult.stderr));assert.equal((await media.metadata(continuous,abort.signal)).hasAudio,true);assert.deepEqual(await media.cuts(continuous,2,analysisSettings.profile('ECONOMIC'),abort.signal),[]);const frameDir=join(root,'frame-fixture');fs.mkdirSync(frameDir);const constantFrames=await media.frames(continuous,frameDir,{start:0,end:2},analysisSettings.profile('ECONOMIC'),abort.signal);assert.equal(constantFrames.length,1,'near identical frames removed');
    failures=1;await worker.tick();let result=(await request(path+'/'+id)).data;assert.equal(result.analysis.status,'COMPLETED',JSON.stringify(result.analysis));assert.ok(result.scenes.length>=2);assert.equal(result.analysis.metadata.hasAudio,false);assert.ok(result.analysis.usage.totalTokens>0);assert.ok(result.scenes.every(s=>s.frames.length>0));assert.ok(result.candidates.some(c=>c.evidence_type==='INFERRED'));assert.ok(result.candidates.every(c=>c.relevance<=60),'synthetic footage does not claim easter egg');
    const paid=aiCalls;await request(path,'POST',body);await worker.tick();assert.equal(aiCalls,paid,'completed fingerprint cache');
    const frame=result.scenes[0].frames[0];const frameResponse=await fetch(base+'/video-remix'+path+`/${id}/frames/${frame.id}`,{headers});assert.equal(frameResponse.status,200);assert.equal(frameResponse.headers.get('content-type'),'image/jpeg');
    let candidate=result.candidates[0];let selection=await request(path+`/${id}/candidates/${candidate.id}`,'PATCH',{selected:true,start:candidate.start_seconds,end:candidate.end_seconds,revision:0});assert.equal(selection.status,200);assert.equal(selection.data.selected,true);
    assert.equal((await request(path+`/${id}/candidates/${candidate.id}`,'PATCH',{selected:true,start:0,end:99,revision:1})).status,400);
    assert.equal((await request(path+`/${id}/candidates/${candidate.id}`,'PATCH',{selected:false,start:0,end:1,revision:0})).status,409);
    values.CONTENT_OWNER_ID='other';assert.equal((await request(path)).status,404);values.CONTENT_OWNER_ID='owner-a';
    const multi=await create('MULTI_SOURCE');let m=multi;for(let i=0;i<2;i++){const r=await upload(m,fixtures.mp4,{ext:'mp4'});assert.equal(r.status,201);m=(await request(`/projects/${m.id}`)).data;}
    const multiPath=`/projects/${m.id}/analysis`;const all=await request(multiPath,'POST',{profile:'ECONOMIC',confirm:true});assert.equal(all.data.items.length,2);await worker.tick();await worker.tick();assert.equal((await request(multiPath)).data.items.filter(j=>j.status==='COMPLETED').length,2);
    // Failure stores bounded error/usage; explicit retry creates a new job.
    values.VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS='3';invalid=true;const bad=(await request(path,'POST',body)).data.items[0].id;await worker.tick();assert.equal((await request(path)).data.items.find(j=>j.id===bad).status,'FAILED');invalid=false;const retry=(await request(path+`/${bad}/retry`,'POST',{})).data.items[0].id;assert.notEqual(retry,bad);await worker.tick();assert.equal((await request(path)).data.items.find(j=>j.id===retry).status,'COMPLETED');
    values.VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS='4';const cancelled=(await request(path,'POST',body)).data.items[0].id;await request(path+`/${cancelled}/cancel`,'POST',{});await worker.tick();assert.equal((await request(path)).data.items.find(j=>j.id===cancelled).status,'CANCELLED');
    values.VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS='5';const running=(await request(path,'POST',body)).data.items[0].id;hold=true;const processing=worker.tick();while(!(await request(path)).data.items.find(j=>j.id===running)?.progress?.stage?.includes('ANALYZING'))await new Promise(r=>setTimeout(r,100));await new Promise(r=>setTimeout(r,100));await request(path+`/${running}/cancel`,'POST',{});await processing;hold=false;assert.equal((await request(path)).data.items.find(j=>j.id===running).status,'CANCELLED');
    values.VIDEO_REMIX_ANALYSIS_MAX_USD='.01';assert.equal((await request(path,'POST',body)).status,400);delete values.VIDEO_REMIX_ANALYSIS_MAX_USD;
    values.VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS='6';
    await require('./remix-analysis.browser.cjs')({api:base,key:values.CONTENT_ACCESS_KEY,root,projectId:p.id,run:()=>worker.tick()});
    // Rights withdrawal blocks analysis and frame access.
    p=(await request(`/projects/${p.id}`)).data;await request(`/projects/${p.id}/sources/${source.id}/authorization`,'PATCH',{revision:p.revision,rights:null});assert.equal((await request(path,'POST',body)).status,400);assert.equal((await fetch(base+'/video-remix'+path+`/${id}/frames/${frame.id}`,{headers})).status,400);
    const stored=(await db.query('SELECT storage_key FROM video_remix_scene_frames WHERE scene_id=$1',[result.scenes[0].id])).rows[0].storage_key;
    p=(await request(`/projects/${p.id}`)).data;await projects.remove(p.id,{revision:p.revision,confirm:true});await files.clean();await assert.rejects(()=>storage.stat(stored));
    assert.equal(fs.readdirSync(analysisSettings.tempDir).length,0,'temporary directories removed');
    fs.writeFileSync(join(root,'evidence.json'),JSON.stringify({passed:true,paidAiCalls:0,mockAiCalls:aiCalls,cuts,sourceCount:2},null,2));
    console.log('PASS Remix analysis: real FFprobe/FFmpeg cuts, silent footage, timestamps/frames, structured AI mocks, bounded retry, cost guard, persistent queue/cache, single/multi source, selection/revision, cancellation, rights/owner access and cleanup. Evidence: '+root);
  } finally {await app?.close();await db?.onModuleDestroy();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
