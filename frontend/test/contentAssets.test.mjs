import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sceneVisual, missingVisualCount, requiredReferencesMissing } from '../src/utils/contentVisualState.js';

const scenes = [1,2,3].map(order => ({id:`scene-${order}`,order,narration:`Narração ${order}`,visualDescription:'Aeroporto',imagePrompt:'Imagem cinematográfica',estimatedDurationSeconds:12}));
const project = {id:'project',revision:5,status:'SCENES_APPROVED',scenes,config:{topic:'Mistério',style:'DARK'}};
const a = {id:'a',projectId:'project',sceneId:scenes[0].id,status:'READY',source:'AI_GENERATED',url:'/content-projects/project/assets/a/file'};
const state = {assets:[a],selections:[{sceneId:scenes[0].id,assetId:'a'}],scenes:[{sceneId:scenes[0].id,selectedAssetId:'a',ready:true,outdated:false}],readyCount:1,totalCount:3,busyCount:0};
test('visual state skips ready/pending scenes and tracks required references in current scenes', () => {
  assert.equal(sceneVisual(state,scenes[0]).selected.id,'a');
  assert.equal(missingVisualCount(state,scenes),2);
  const pending={...state,assets:[a,{id:'b',sceneId:scenes[1].id,status:'GENERATING',source:'AI_GENERATED'}]};
  assert.equal(missingVisualCount(pending,scenes),1);
  const ref={id:'ref',sceneId:null,status:'READY',usage:'REQUIRED'};
  assert.equal(requiredReferencesMissing({...state,assets:[a,ref],selections:[...state.selections,{sceneId:'old-scene',assetId:'ref'}]}).length,1);
  assert.equal(requiredReferencesMissing({...state,assets:[a,ref],scenes:[{sceneId:scenes[0].id,selectedAssetId:'ref',ready:true}]}).length,0);
});
test('production preview, variations, upload, errors, retry, loading, outdated and progress render', async t => {
  const server=await createServer({server:{middlewareMode:true},appType:'custom'});
  try {
    const {VisualProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VisualProduction.jsx');
    const {VisualReferences}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VisualReferences.jsx');
    const {ContentStudioStepper}=await server.ssrLoadModule('/src/pages/ContentCreation/components/ContentStudioStepper.jsx');
    const render=props=>renderToStaticMarkup(createElement(VisualProductionView,{project,state,...props}));
    await t.test('ready preview and missing generation action',()=>{
      const html=render({}); for(const text of ['1 / 3 prontas','Gerar imagem','Gerar novamente','Usar minha imagem','Selecionada','Gerar imagens faltantes','Narração','Em breve']) assert.ok(html.includes(text),text);
      assert.match(html,/type="file"/); assert.match(html,/image\/png,image\/jpeg,image\/webp/); assert.match(html,/<progress/); assert.match(html,/assets\/a\/file/);
    });
    await t.test('approved projects can navigate back into production',()=>{
      const html=renderToStaticMarkup(createElement(ContentStudioStepper,{activeStep:'scenes',hasScenes:true,projectSteps:{config:true,idea:true,script:true,scenes:true,production:true}}));
      assert.ok(!html.includes('disponível em breve')); assert.doesNotMatch(html, /disabled=""/);
    });
    await t.test('multiple variations do not trigger generation to select',()=>{
      const html=render({state:{...state,assets:[a,{...a,id:'b',source:'USER_UPLOAD',url:'/b'}]}});
      assert.ok(html.includes('Usar esta imagem')); assert.ok(html.includes('Enviada')); assert.match(html,/aria-pressed="true"/);
    });
    await t.test('per-scene failures and retry',()=>{
      const html=render({state:{...state,assets:[a,{id:'failed',sceneId:scenes[1].id,source:'AI_GENERATED',status:'FAILED',error:'Provider indisponível'}]}});
      assert.ok(html.includes('Provider indisponível')); assert.ok(html.includes('Tentar novamente')); assert.ok(html.includes('assets/a/file'));
    });
    await t.test('pending, loading and blocked production',()=>{
      assert.ok(render({loading:true}).includes('Carregando imagens'));
      assert.ok(render({state:{...state,busyCount:1,assets:[a,{id:'b',sceneId:scenes[1].id,source:'AI_GENERATED',status:'GENERATING'}]}}).includes('Gerando imagem'));
      const html=render({project:{...project,status:'SCENES_GENERATED'}}); assert.ok(html.includes('Aprove as cenas atuais')); assert.match(html,/disabled/);
    });
    await t.test('outdated selected image can be kept',()=>{
      const html=render({state:{...state,scenes:[{...state.scenes[0],outdated:true}]}}); assert.ok(html.includes('versão anterior')); assert.ok(html.includes('Manter esta imagem'));
    });
    await t.test('project references explain supported behavior',()=>{
      const html=renderToStaticMarkup(createElement(VisualReferences,{project})); for(const text of ['Obrigatória','Referência','Opcional','10 MB','não são encaminhadas']) assert.ok(html.includes(text),text);
    });
    await t.test('service sends revision, confirmation and multipart without JSON header',async()=>{
      const {contentAssets}=await server.ssrLoadModule('/src/services/contentAssetService.js');
      const original=globalThis.fetch,calls=[];
      globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({queued:1})};};
      try {
        await contentAssets.generate(project,scenes[0].id); await contentAssets.missing(project); await contentAssets.select(project,scenes[0].id,'a');
        await contentAssets.upload(project,scenes[0].id,new Blob(['png'],{type:'image/png'}));
        assert.equal(JSON.parse(calls[0].options.body).revision,5); assert.equal(JSON.parse(calls[1].options.body).confirm,true); assert.equal(calls[2].options.method,'PATCH'); assert.deepEqual(calls[3].options.headers,{}); assert.equal(calls[3].options.body.get('revision'),'5');
        globalThis.fetch=async()=>{throw Error('Failed to fetch');}; await assert.rejects(contentAssets.list('project'),/backend está em execução/);
      } finally {globalThis.fetch=original;}
    });
  } finally {await server.close();}
});
