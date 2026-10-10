import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const scene={id:'s',order:1},config={width:1920,height:1080,fps:30,motion:true};
const project={id:'p',revision:2,scenes:[scene]};
const snapshot={config,totalDurationSeconds:3.3,scenes:[{sceneId:'s',order:1,startSeconds:0,endSeconds:3.3,durationSeconds:3.3,audioDurationSeconds:3,imageAssetId:'image',audioAssetId:'audio'}]};
const preview={ready:true,issues:[],timeline:snapshot};
const job={id:'job',status:'COMPLETED',progress:100,createdAt:'2026-10-10T12:00:00Z',snapshot,videoUrl:'/video',downloadUrl:'/download'};
test('render production UI and request contracts',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {VideoProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VideoProduction.jsx');
  const render=props=>renderToStaticMarkup(createElement(VideoProductionView,{project,preview,jobs:[],...props}));
  await t.test('timeline, real audio duration, selected assets and generate action',()=>{const html=render({});for(const text of ['Gerar vídeo','Timeline','3.30 s','1920 × 1080','Narração selecionada','Movimento suave'])assert.ok(html.includes(text),text);});
  await t.test('missing assets disable generation and show useful reasons',()=>{const html=render({preview:{...preview,ready:false,issues:[{sceneId:'s',order:1,message:'Narração não selecionada'}]}});assert.ok(html.includes('Cena 1: Narração não selecionada'));assert.match(html,/disabled/);});
  await t.test('actual status/progress and working cancellation action',()=>{const active={...job,status:'RENDERING',progress:65};const html=render({jobs:[active]});for(const text of ['65%','Renderizando cenas','Cancelar renderização'])assert.ok(html.includes(text));assert.match(html,/<progress/);});
  await t.test('history, HTML5 player, download, reopen and failure',()=>{const html=render({jobs:[job,{...job,id:'failed',status:'FAILED',error:'FFmpeg indisponível'}]});for(const text of ['Histórico de renderizações','Baixar MP4','Gerar nova versão','FFmpeg indisponível'])assert.ok(html.includes(text));assert.match(html,/<video[^>]+controls/);assert.match(html,/href="[^"]*\/download"/);});
  await t.test('service sends revision and propagates detailed validation errors',async()=>{const {videoRenders}=await server.ssrLoadModule('/src/services/videoRenderService.js');const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>job};};try{await videoRenders.create(project);await videoRenders.cancel(project.id,job.id);await videoRenders.list(project.id);await videoRenders.timeline(project.id);assert.equal(JSON.parse(calls[0].options.body).revision,2);assert.equal(calls[1].options.method,'POST');assert.ok(calls[1].url.endsWith('/renders/job/cancel'));globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({message:'Assets pendentes',issues:[{order:1,message:'Falta áudio'}]})});await assert.rejects(videoRenders.create(project),e=>e.issues.length===1);}finally{globalThis.fetch=original;}});
 }finally{await server.close();}
});
