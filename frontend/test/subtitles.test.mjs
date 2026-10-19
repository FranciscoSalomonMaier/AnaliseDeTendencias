import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('subtitle production controls and persistence contracts',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
 const {SubtitleProductionView,SubtitlePreview}=await server.ssrLoadModule('/src/pages/ContentCreation/components/SubtitleProduction.jsx');
 const {VideoProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VideoProduction.jsx');
 const settings={enabled:true,preset:'DYNAMIC',fontSize:48,textColor:'#FFFFFF',highlightColor:'#FFD700',outlineWidth:2,shadow:1,verticalPosition:0.86,bottomMargin:80,maxLines:2,maxWords:5,maxCharacters:42};
 const project={id:'project',revision:4,scenes:[{id:'scene',order:1}]},segment={id:'seg',order:1,text:'Um avião',startSeconds:0.2,endSeconds:2,words:[{text:'Um',startSeconds:0.2,endSeconds:0.5},{text:'avião',startSeconds:0.6,endSeconds:2}]};
 const version={id:'version',sceneId:'scene',audioAssetId:'audio',status:'READY',createdAt:new Date().toISOString(),data:{segments:[segment],granularity:'WORD',audioDurationSeconds:3,reviewRequired:false}};
 const state={readyCount:1,busyCount:0,settings,versions:[version],scenes:[{sceneId:'scene',audioAssetId:'audio',selectedId:'version',ready:true}],visualSelections:[]};
 const render=props=>renderToStaticMarkup(createElement(SubtitleProductionView,{project,state,settings,onSceneDirty:()=>{},...props}));
 await t.test('generation, batch, settings, presets and export controls',()=>{const html=render();for(const text of ['Gerar legendas novamente','Gerar legendas faltantes','Exportar SRT','Classic','Dark Cinematic','Dynamic','Incorporar legendas','Salvar configurações','Tamanho da fonte','Cor do destaque','Máximo de linhas'])assert.ok(html.includes(text),text);});
 await t.test('editor exposes persisted text and relative timestamp inputs',()=>{const html=render();for(const text of ['Um avião','value="0.2"','value="2"','Salvar legendas','Descartar edição','Timestamps por palavra','Tempos relativos','Versões do áudio atual'])assert.ok(html.includes(text),text);assert.ok(html.includes('<audio'));assert.ok(html.includes('onTimeUpdate')===false);});
 await t.test('preview uses actual word intervals, colors and style without timer',()=>{const html=renderToStaticMarkup(createElement(SubtitlePreview,{settings,segment,currentTime:0.8}));assert.ok(html.includes('color:#FFD700">avião'));assert.ok(html.includes('color:#FFFFFF">Um'));assert.ok(html.includes('top:86%'));assert.ok(html.includes('Subtitle Liberation'));});
 await t.test('outdated transcript, provider failures, and processing are visible',()=>{const html=render({error:'Provider indisponível',state:{...state,scenes:[{...state.scenes[0],outdated:true}],versions:[{...version,data:{...version.data,reviewRequired:true,matchScore:0.4}},{...version,id:'failed',status:'FAILED',error:'Falha na transcrição'}]}});for(const text of ['Provider indisponível','versão anterior','40%','Confirmar legendas revisadas','Falha na transcrição'])assert.ok(html.includes(text),text);});
 await t.test('unsaved subtitles prevent video generation',()=>{const html=renderToStaticMarkup(createElement(VideoProductionView,{project,jobs:[],preview:{ready:true,issues:[]},subtitleDraftDirty:true}));assert.ok(html.includes('Salve as legendas'));assert.ok(html.includes('disabled'));});
 await t.test('HTTP contracts preserve revision and exact subtitle version',async()=>{const {subtitles}=await server.ssrLoadModule('/src/services/subtitleService.js');const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>state};};try{await subtitles.generate(project,'scene',true);await subtitles.edit(project,'scene','version',[segment]);await subtitles.settings(project,settings);await subtitles.select(project,'scene','version');assert.ok(calls[0].url.endsWith('/scenes/scene/subtitles/generate'));assert.deepEqual(JSON.parse(calls[0].options.body),{revision:4,replace:true});assert.ok(calls[1].url.endsWith('/subtitles/version'));assert.equal(JSON.parse(calls[2].options.body).settings.preset,'DYNAMIC');assert.equal(JSON.parse(calls[3].options.body).confirmReview,true);}finally{globalThis.fetch=prior;}});
 }finally{await server.close();}
});
