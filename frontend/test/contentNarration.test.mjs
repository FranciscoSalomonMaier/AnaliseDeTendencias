import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sceneNarration, missingNarrationCount, audioDurationLabel } from '../src/utils/contentNarrationState.js';
const scene={id:'scene',order:1,narration:'Uma noite escura',estimatedDurationSeconds:10};
const project={id:'project',revision:2,status:'SCENES_APPROVED',config:{style:'DARK'},scenes:[scene]};
const asset={id:'audio',sceneId:scene.id,type:'AUDIO',status:'READY',source:'AI_GENERATED',voice:'cedar',durationSeconds:8.4,url:'/content-projects/project/assets/audio/file'};
const settings={voice:'cedar',style:'DARK',speed:1};
const state={assets:[asset],scenes:[{sceneId:scene.id,selectedAssetId:asset.id,ready:true}],selections:[],settings,voices:['cedar','marin'],styles:['DARK','NARRATIVE'],readyCount:1,busyCount:0};
test('audio state handles ready, missing, pending, historical and outdated selections',()=>{
 assert.equal(sceneNarration(state,scene).selected.id,'audio');assert.equal(missingNarrationCount(state,[scene]),0);assert.equal(missingNarrationCount({...state,scenes:[]},[scene]),1);
 assert.equal(missingNarrationCount({...state,scenes:[],assets:[{...asset,status:'GENERATING'}]},[scene]),0);assert.equal(audioDurationLabel(8.4),'8,4 s');
 assert.equal(sceneNarration({...state,scenes:[{...state.scenes[0],outdated:true,ready:false}]},scene).outdated,true);
});
test('narration UI exposes settings, controls, progress, errors, versions, upload and stale text',async t=>{
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});
 try {
  const {NarrationProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/NarrationProduction.jsx');
  const render=props=>renderToStaticMarkup(createElement(NarrationProductionView,{project,state,draft:settings,...props}));
  await t.test('saved voice, style, duration, native player and progress',()=>{const html=render({});for(const text of ['Voz do projeto','Estilo da narração','Velocidade da narração','1 / 1 narrações prontas','8,4 s','Voz gerada por IA','Ver versões de áudio','Enviar áudio','Regenerar narração','Ouvir amostra'])assert.ok(html.includes(text),text);assert.match(html,/<audio[^>]+controls/);assert.match(html,/<progress/);assert.match(html,/audio\/mpeg,audio\/wav/);});
  await t.test('alternate version selection and failed retry preserve player',()=>{const html=render({state:{...state,assets:[asset,{...asset,id:'upload',source:'USER_UPLOAD'},{id:'failed',sceneId:scene.id,source:'AI_GENERATED',status:'FAILED',error:'Provider indisponível'}]}});for(const text of ['Usar este áudio','Upload próprio','Tentar novamente','Provider indisponível'])assert.ok(html.includes(text),text);assert.match(html,/<audio/);});
  await t.test('loading, pending and unsaved voice guard',()=>{assert.ok(render({loading:true}).includes('Carregando narrações'));assert.ok(render({draft:{...settings,voice:'marin'}}).includes('Salve as configurações'));assert.ok(render({state:{...state,assets:[{...asset,status:'GENERATING'}],busyCount:1}}).includes('Gerando narração'));});
  await t.test('outdated audio remains visibly old after keeping',()=>{const stale={...state,scenes:[{...state.scenes[0],outdated:true,textOutdated:true}]};assert.ok(render({state:stale}).includes('Manter áudio'));assert.ok(render({state:{...stale,scenes:[{...stale.scenes[0],accepted:true}]}}).includes('Mantido por você'));});
  await t.test('service persists voice and sends revision/confirmation/multipart',async()=>{
   const {contentNarration}=await server.ssrLoadModule('/src/services/contentNarrationService.js');const original=globalThis.fetch,calls=[];
   globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>state};};
   try {await contentNarration.settings(project,settings);await contentNarration.generate(project,scene.id);await contentNarration.missing(project);await contentNarration.sample(project);await contentNarration.select(project,scene.id,asset.id);await contentNarration.upload(project,scene.id,new Blob(['wav'],{type:'audio/wav'}));await contentNarration.list(project.id);
    assert.equal(JSON.parse(calls[0].options.body).voice,'cedar');assert.equal(JSON.parse(calls[1].options.body).revision,2);assert.equal(JSON.parse(calls[2].options.body).confirm,true);assert.equal(JSON.parse(calls[3].options.body).confirm,true);assert.equal(calls[4].options.method,'PATCH');assert.deepEqual(calls[5].options.headers,{});assert.equal(calls[5].options.body.get('revision'),'2');assert.equal(calls[6].options.method,'GET');
    globalThis.fetch=async()=>{throw Error('network');};await assert.rejects(contentNarration.list(project.id),/backend/);
   } finally {globalThis.fetch=original;}
  });
 }finally{await server.close();}
});
