// Run after npm run build; requires a disposable PostgreSQL, Vite and local Chrome.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { TrendingTopicsController } = require('../../dist/trends/trending-topics.controller');
const { TrendingTopicsService } = require('../../dist/trends/trending-topics.service');
const { TopicClusteringService } = require('../../dist/trends/topic-clustering.service');
const { YoutubeMetricsRepository } = require('../../dist/src/sources/youtube/youtube-metrics.repository');
const { PostgresDatabaseService } = require('../../dist/src/database/postgres-database.service');
const { YouTubeNormalizerService } = require('../../dist/src/sources/youtube/youtube-normalizer/youtube-normalizer.service');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn) {
  for(let i=0;i<100;i++){ const value=await fn();if(value)return value;await sleep(100); }
  throw new Error('Timed out waiting for browser state');
}
async function main() {
  if(!process.env.YOUTUBE_TEST_DATABASE_URL) throw new Error('Disposable database required');
  const client = new Client({connectionString:process.env.YOUTUBE_TEST_DATABASE_URL});
  let app, vite, chrome, socket;
  try {
    await client.connect();
    await client.query(readFileSync('migrations/001_youtube_metric_snapshots.sql','utf8'));
    await client.query(readFileSync('migrations/002_semantic_topics.sql','utf8'));
    await client.query('BEGIN');
    const now=new Date(), start=new Date(now.getTime()-7*86400000), recent=new Date(now.getTime()-600000);
    for(const [id,title,delta] of [['a','GTA 6 Rockstar Trailer',100000],['b','GTA 6 Rockstar Gameplay',200000],['c','GTA 6 Rockstar Mapa',350000],['d','Receita bolo chocolate',1000]]){
      const video={id,snippet:{title,channelTitle:'Canal teste',publishedAt:'2026-01-01',tags:id==='d'?['bolo']:['GTA 6','Rockstar'],categoryId:id==='d'?'26':'20'},statistics:{viewCount:String(1000+delta)}};
      await client.query('INSERT INTO youtube_videos VALUES($1,$2)',[id,JSON.stringify(video)]);
      await client.query("INSERT INTO youtube_video_regions VALUES($1,'BR')",[id]);
      for(const [at,views] of [[start,1000],[recent,1000],[now,1000+delta]])await client.query('INSERT INTO youtube_video_metric_snapshots(video_id,view_count,captured_at,capture_slot) VALUES($1,$2,$3,$3)',[id,views,at]);
    }
    await client.query(`INSERT INTO youtube_semantic_topics(id,region_code,model,name,keywords,entities,centroid,naming_source,naming_hash,member_ids) VALUES
      ('00000000-0000-4000-8000-000000000001','BR','test-model','GTA 6',ARRAY['GTA 6','Rockstar'],ARRAY['GTA 6'],ARRAY[1.0,0.0],'entity','test',ARRAY['a','b','c']),
      ('00000000-0000-4000-8000-000000000002','BR','test-model','Bolo de chocolate',ARRAY['Bolo','Chocolate'],ARRAY[]::text[],ARRAY[0.0,1.0],'llm','test',ARRAY['d'])`);
    for (const id of ['a','b','c','d']) await client.query("INSERT INTO youtube_video_topics VALUES('BR',$1,$2,'test')",[id,id==='d'?'00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000001']);
    class TestModule {}
    Module({controllers:[TrendingTopicsController],providers:[TrendingTopicsService,TopicClusteringService,YouTubeNormalizerService,YoutubeMetricsRepository,{provide:PostgresDatabaseService,useValue:{query:(sql,params)=>client.query(sql,params)}}]})(TestModule);
    app=await NestFactory.create(TestModule,{logger:false});
    app.enableCors();
    await app.listen(33441,'127.0.0.1');
    for(const query of ['period=invalid','limit=0','limit=101','regionCode=invalid'])assert.equal((await fetch(`http://127.0.0.1:33441/trends/youtube/topics?${query}`)).status,400);
    const response=await fetch('http://127.0.0.1:33441/trends/youtube/topics?period=7d&limit=20');
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.topics[0].viewsInPeriod,'650000');
    assert.equal(body.topics[0].videoCount,3);
    console.log('PASS HTTP: real service, persisted topics, aggregation, limit and invalid parameters; 100000+200000+350000=650000');
    process.env.VITE_API_URL='http://127.0.0.1:33441';
    const { createServer }=await import(resolve('../frontend/node_modules/vite/dist/node/index.js'));
    vite=await createServer({root:resolve('../frontend'),server:{host:'127.0.0.1',port:33442,strictPort:true}});
    await vite.listen();
    chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=33443',`--user-data-dir=${mkdtempSync('/tmp/trends-topics-chrome-')}`,'about:blank'],{stdio:'ignore'});
    const targets=await until(async()=>{try{return await (await fetch('http://127.0.0.1:33443/json/list')).json();}catch{return null;}});
    socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
    let next=0, paused=null;
    const pending=new Map(), errors=[], requests=[];
    socket.onmessage=({data})=>{const event=JSON.parse(data);if(event.id){const task=pending.get(event.id);pending.delete(event.id);event.error?task.reject(new Error(event.error.message)):task.resolve(event.result);}else if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);else if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='error')errors.push('console.error');else if(event.method==='Network.requestWillBeSent')requests.push(event.params.request.url);else if(event.method==='Fetch.requestPaused')paused=event.params;};
    function command(method,params={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
    async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;}
    await command('Runtime.enable');await command('Network.enable');await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await command('Page.navigate',{url:'http://127.0.0.1:33442/?page=trending-topics'});
    await until(()=>evaluate("document.body.innerText.includes('Ranking exibido: Hoje') && document.querySelectorAll('article').length===2"));
    assert.ok(await evaluate("document.body.innerText.includes('GTA 6')"));
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='7 dias').click()");
    await until(()=>evaluate("document.body.innerText.includes('Ranking exibido: 7 dias')"));
    assert.ok(requests.some(url=>url.includes('/trends/youtube/topics?')&&url.includes('period=7d')));
    assert.equal(await evaluate("document.querySelector('button[aria-pressed=true]').innerText"),'7 dias');
    await evaluate("document.querySelector('summary').click()");
    assert.equal(await evaluate("document.querySelector('details').open"),true);
    assert.ok(await evaluate("document.querySelectorAll('details[open] a').length===3"));
    for(const width of [1440,768,390]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});
      await sleep(150);
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`horizontal overflow at ${width}`);
      if(width<768) await until(()=>evaluate("document.querySelector('aside').getBoundingClientRect().width <= 80"));
    }
    const shot=await command('Page.captureScreenshot',{format:'png'});
    writeFileSync('/tmp/trends-topics-mobile.png',Buffer.from(shot.data,'base64'));
    await command('Fetch.enable',{patterns:[{urlPattern:'*/trends/youtube/topics*',requestStage:'Request'}]});
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='30 dias').click()");
    await until(()=>paused);
    assert.ok(await evaluate("document.body.innerText.includes('Carregando temas: 30 dias')"));
    assert.ok(await evaluate("document.body.innerText.includes('Mantendo o último resultado: 7 dias')"));
    await command('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:500,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Content-Type',value:'application/json'}],body:Buffer.from('{}').toString('base64')});paused=null;
    await until(()=>evaluate("document.body.innerText.includes('Não foi possível carregar os temas em alta.')"));
    // Chrome logs the deliberately simulated HTTP 500; only JS exceptions/console errors are collected above.
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText==='Tentar novamente').click()");
    await until(()=>paused);
    await command('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:200,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({period:'30d',topics:[]})).toString('base64')});paused=null;
    await until(()=>evaluate("document.body.innerText.includes('Nenhum tema identificado para este período.')"));
    assert.deepEqual(errors,[]);
    console.log('PASS browser: loading, period request/selection, ranking, partial coverage, details expansion, retry, error, empty, console, responsive widths 1440/768/390');
    await client.query('ROLLBACK');
  } finally {
    if(socket)socket.close();
    if(chrome)chrome.kill('SIGTERM');
    if(vite)await vite.close();
    if(app)await app.close();
    await client.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
