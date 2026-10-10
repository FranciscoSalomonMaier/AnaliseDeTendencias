import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('music and effect production controls and API contracts',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
 const {AudioMixProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/AudioMixProduction.jsx');
 const {VideoProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VideoProduction.jsx');
 const settings={backgroundMusicAssetId:'music',musicVolume:0.2,musicFadeInSeconds:2,musicFadeOutSeconds:3,loopMusic:true,duckingEnabled:true,effects:[{id:'fx',sceneId:'scene',assetId:'sound',startOffsetSeconds:0.5,volume:0.35,enabled:true,scope:'SCENE'}]};
 const project={id:'project',revision:3,scenes:[{id:'scene',order:1}]};
 const assets=[{id:'music',url:'/music.wav',durationSeconds:6,metadata:{audioRole:'BACKGROUND_MUSIC',originalName:'ambient.wav',license:'Own work'}},{id:'sound',url:'/fx.wav',durationSeconds:1,metadata:{audioRole:'SOUND_EFFECT',originalName:'impact.wav'}}];
 const render=props=>renderToStaticMarkup(createElement(AudioMixProductionView,{project,state:{assets,settings},draft:settings,metadata:{origin:'Upload do usuário',license:'',notes:''},...props}));
 await t.test('upload, selection, preview, volume, fades, loop and real ducking controls',()=>{const html=render();for(const text of ['Enviar música','Enviar efeito sonoro','ambient.wav','20%','Fade-in','Fade-out','Repetir música','Reduzir música durante narração','Preview da música','Own work'])assert.ok(html.includes(text),text);assert.ok(html.includes('isoladamente'));});
 await t.test('scene effects, offset, gain, enable and removal',()=>{const html=render();for(const text of ['impact.wav','Offset do efeito fx','35%','Remover efeito','Adicionar efeito na cena 1','fim da cena'])assert.ok(html.includes(text),text);});
 await t.test('explicit dirty save, error and persisted configuration',()=>{const html=render({draft:{...settings,musicVolume:0.15},error:'Offset inválido'});assert.ok(html.includes('15%'));assert.ok(html.includes('Salvar mixagem'));assert.ok(html.includes('Salve a mixagem'));assert.ok(html.includes('Offset inválido'));assert.ok(render().includes('ambient.wav'));});
 await t.test('optional audio and obsolete scene associations',()=>{assert.ok(render({draft:{...settings,backgroundMusicAssetId:null,effects:[]}}).includes('Sem música'));assert.ok(render({draft:{...settings,effects:[{...settings.effects[0],sceneId:'old'}]}}).includes('Remover efeitos das cenas antigas'));});
 await t.test('video generation is blocked for unsaved mix',()=>{const html=renderToStaticMarkup(createElement(VideoProductionView,{project,jobs:[],preview:{ready:true,issues:[]},audioDraftDirty:true}));assert.ok(html.includes('Salve a mixagem'));assert.match(html,/disabled/);});
 await t.test('service persists revision/settings and streams multipart upload metadata',async()=>{const {projectAudio}=await server.ssrLoadModule('/src/services/projectAudioService.js');const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({settings})};};try{await projectAudio.save(project,settings);const data=JSON.parse(calls[0].options.body);assert.equal(data.revision,3);assert.equal(data.settings.musicVolume,0.2);await projectAudio.upload(project,'SOUND_EFFECT',new Blob(['audio'],{type:'audio/wav'}),{license:'Own',origin:'Me',notes:'test'});assert.ok(calls[1].url.endsWith('/sound-effects/upload'));assert.equal(calls[1].options.body.get('license'),'Own');assert.deepEqual(calls[1].options.headers,{});}finally{globalThis.fetch=prior;}});
 }finally{await server.close();}
});
