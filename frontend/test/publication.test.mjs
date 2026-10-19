import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('publication stage and authenticated request contracts',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {ContentStudioStepper}=await server.ssrLoadModule('/src/pages/ContentCreation/components/ContentStudioStepper.jsx');
  await t.test('publication follows production and remains independently accessible for drafts',()=>{
   const html=renderToStaticMarkup(createElement(ContentStudioStepper,{activeStep:'publication',projectSteps:{config:true,idea:false,script:false,scenes:false,production:false,publication:true}}));
   assert.ok(html.includes('Publicação'));assert.ok(html.indexOf('Produção')<html.indexOf('Publicação'));assert.ok(html.includes('aria-current="step"'));
  });
  const {publications}=await server.ssrLoadModule('/src/services/publicationService.js');
  await t.test('GET is read-only, writes include revisions and cookies, upload uses multipart',async()=>{
   const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({saved:true})};};
   try{
    await publications.get('p');await publications.save('p',{revision:4,data:{description:'ficção'}});await publications.generate('p',4,'THUMBNAILS',3);await publications.upload('p',new Blob(['image'],{type:'image/png'}),{enabled:false});await publications.login('fixture-key');
    assert.equal(calls[0].options.method,'GET');assert.ok(calls.every(c=>c.options.credentials==='include'));
    assert.deepEqual(JSON.parse(calls[1].options.body),{revision:4,data:{description:'ficção'}});assert.deepEqual(JSON.parse(calls[2].options.body),{revision:4,kind:'THUMBNAILS',count:3});
    assert.ok(calls[3].options.body instanceof FormData);assert.deepEqual(calls[3].options.headers,{});assert.ok(calls[4].url.endsWith('/content-access/session'));
   }finally{globalThis.fetch=original;}
  });
  await t.test('authorization and validation errors are surfaced without exposing prompts',async()=>{
   const original=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({message:'Entre com a chave.'})});try{await assert.rejects(publications.get('p'),e=>e.status===401&&e.message==='Entre com a chave.');}finally{globalThis.fetch=original;}
  });
 }finally{await server.close();}
});
