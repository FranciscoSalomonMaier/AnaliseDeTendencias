import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('vertical production, captions, destinations and explicit adaptation contracts',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {VideoProductionView}=await server.ssrLoadModule('/src/pages/ContentCreation/components/VideoProduction.jsx');
  const {ProjectConfiguration}=await server.ssrLoadModule('/src/pages/ContentCreation/components/ProjectConfiguration.jsx');
  const {SubtitlePreview}=await server.ssrLoadModule('/src/pages/ContentCreation/components/SubtitleProduction.jsx');
  const {SceneFramingPreview}=await server.ssrLoadModule('/src/pages/ContentCreation/components/SceneFramingPreview.jsx');
  const {publications}=await server.ssrLoadModule('/src/services/publicationService.js');
  const {contentProjects}=await server.ssrLoadModule('/src/services/contentProjectService.js');
  const config={topic:'Uma história',style:'DARK',language:'pt-BR',instructions:'',aspectRatio:'9:16',targetDurationSeconds:30};
  const project={id:'p',revision:3,config,scenes:[]};
  await t.test('creation offers both orientations and short/custom durations',()=>{
   const html=renderToStaticMarkup(createElement(ProjectConfiguration,{config}));
   for(const value of ['9:16','16:9','30 segundos','60 segundos','90 segundos','Duração personalizada'])assert.ok(html.includes(value),value);
  });
  await t.test('history respects immutable resolution and vertical player width',()=>{
   const snapshot={config:{width:1080,height:1920,fps:30},totalDurationSeconds:75,scenes:[]};
   const html=renderToStaticMarkup(createElement(VideoProductionView,{project,preview:{ready:true,issues:[],timeline:snapshot},jobs:[{id:'v',status:'COMPLETED',createdAt:'2026-10-19',snapshot,videoUrl:'/video',downloadUrl:'/download'}]}));
   for(const value of ['9:16','1080 × 1920','max-width:400px','aspect-ratio:1080/1920','Nenhum áudio será cortado','Baixar MP4'])assert.ok(html.includes(value),value);
  });
  await t.test('vertical caption preview and crop keep aspect ratio',()=>{
   const html=renderToStaticMarkup(createElement(SubtitlePreview,{aspectRatio:'9:16',settings:{fontSize:48,maxLines:2,bottomMargin:80,verticalPosition:0.75,outlineWidth:2,shadow:1,preset:'CLASSIC'}}));
   assert.ok(html.includes('aspect-ratio:9/16'));assert.ok(html.includes('max-width:400px'));
   const crop=renderToStaticMarkup(createElement(SceneFramingPreview,{src:'/image',choice:{fit:'COVER',focalX:0.8},aspectRatio:'9:16'}));
   assert.ok(crop.includes('width="270"'));assert.ok(crop.includes('height="480"'));
  });
  await t.test('destinations are explicit and adaptation is a single authenticated action',async()=>{
   const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({})};};
   try{
    await publications.get('p','YOUTUBE_SHORTS');await publications.save('p',{revision:2,data:{}},'INSTAGRAM_REELS');await publications.generate('p',2,'METADATA',1,'YOUTUBE_SHORTS');await contentProjects.createShort(project,60);
    assert.ok(calls[0].url.endsWith('?target=YOUTUBE_SHORTS'));assert.ok(calls[1].url.endsWith('?target=INSTAGRAM_REELS'));assert.ok(calls[2].url.includes('/generate?target=YOUTUBE_SHORTS'));
    assert.ok(calls[3].url.endsWith('/p/create-short-version'));assert.deepEqual(JSON.parse(calls[3].options.body),{revision:3,targetDurationSeconds:60,confirm:true});assert.ok(calls.every(c=>c.options.credentials==='include'));
   }finally{globalThis.fetch=original;}
  });
 }finally{await server.close();}
});
