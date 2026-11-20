module.exports=async function({api,base,save,run,get,set,id,root,settings,renders,storage,musicRenderer,values,fs,join,spawnSync,assert}){
 const ff=(args)=>{const r=spawnSync(renders.ffmpegPath,['-v','error','-nostdin',...args],{maxBuffer:16*1024**2});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;};
 const wave=(seconds,freq,amp,voice=false)=>{const rate=48000,count=rate*seconds,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++){const t=i/rate,value=voice&&t>=2&&t<4?0:Math.sin(2*Math.PI*freq*t)*amp;b.writeInt16LE(Math.round(value*32767),44+i*2);}return b;};
 const raw=join(root,'music.wav');fs.writeFileSync(raw,wave(2,1000,.3));
 await save({step:7});const originalAudio=get().data.audio.url;
 const upload=async(path,mime='audio/wav',expected=201,rights=true,revision=get().revision)=>{const form=new FormData();form.append('rights',String(rights));form.append('revision',String(revision));form.append('file',new Blob([fs.readFileSync(path)],{type:mime}),path.split('/').at(-1));const result=await api('/shorts/'+id+'/music','POST',form,expected);if(expected===201)set(result);return result;};
 await upload(raw,'audio/wav',400,false);await upload(raw,'audio/wav',409,true,get().revision-1);
 const bad=join(root,'invalid.mp3');fs.writeFileSync(bad,'not audio');await upload(bad,'audio/mpeg',400);
 const forged=join(root,'forged.mp3');fs.copyFileSync(raw,forged);await upload(forged,'audio/mpeg',400);
 const video=join(root,'video-only.m4a');fs.copyFileSync(join(root,'a.mp4'),video);await upload(video,'audio/mp4',400);
 values.SHORT_MUSIC_UPLOAD_MAX_MB='1';const big=join(root,'too-large.wav');fs.writeFileSync(big,Buffer.alloc(1024**2+1));await upload(big,'audio/wav',400);values.SHORT_MUSIC_UPLOAD_MAX_MB='50';
 for(const [ext,codec,mime]of [['mp3','libmp3lame','audio/mpeg'],['wav','pcm_s16le','audio/wav'],['aac','aac','audio/aac'],['m4a','aac','audio/mp4'],['ogg','libvorbis','audio/ogg'],['flac','flac','audio/flac']]){
   const path=join(root,'test-music.'+ext);ff(['-i',raw,'-map','0:a:0','-c:a',codec,'-y',path]);await upload(path,mime);
   assert.equal(get().data.music.originalName,'test-music.'+ext);assert.ok(Math.abs(get().data.music.duration-2)<.15);assert.ok(!JSON.stringify(get()).includes('shorts/'+id+'/music/'));assert.ok(get().data.music.rightsDeclaredAt);
 }
 assert.equal(get().data.audio.url,originalAudio);assert.equal(get().data.planApproved,true);assert.equal(get().data.output,null);
 const auth={Authorization:'Bearer test-local-only'};
 let preview=await fetch(base+get().data.music.url,{headers:{...auth,Range:'bytes=0-31'}});assert.equal(preview.status,206);assert.equal((await preview.arrayBuffer()).byteLength,32);
 values.CONTENT_OWNER_ID='owner-b';await api('/shorts/'+id+'/music','GET',null,404);values.CONTENT_OWNER_ID='owner-a';
 await save({musicSettings:{volume:.15,fadeIn:true,fadeInSeconds:1,fadeOut:true,fadeOutSeconds:.5,loop:true,ducking:true}});
 assert.equal((await api('/shorts/'+id)).data.musicSettings.volume,.15);
 await run('RENDER');assert.equal(get().step,9);assert.ok(Math.abs(get().data.output.duration-7)<.35);
 await save({step:7});await save({musicSettings:{...get().data.musicSettings,volume:1}});assert.equal(get().data.output,null);assert.equal(get().data.audio.url,originalAudio);assert.ok(get().data.plan);
 await save({skipMusic:true,step:8});assert.equal(get().data.musicEnabled,false);await run('RENDER');assert.equal(get().status,'COMPLETED');
 await save({step:7});set(await api('/shorts/'+id+'/music','DELETE',{revision:get().revision}));assert.equal(get().data.music,null);assert.equal(get().data.musicSettings.volume,1);
 await upload(raw);assert.equal(get().data.musicSettings.volume,1);assert.equal(get().data.musicEnabled,true);set(await api('/shorts/'+id+'/music','DELETE',{revision:get().revision}));
 // Audio-only real FFmpeg tests isolate the effect of each setting, with an audible
 // 440 Hz narration and a 1 kHz background tone. No external or paid calls.
 const narration=join(root,'synthetic-voice.wav');fs.writeFileSync(narration,wave(6,440,.2,true));
 const musicKey='test-music.wav';await storage.save(musicKey,wave(2,1000,.3));
 const metadata={id:'11111111-1111-4111-8111-111111111111',key:musicKey,originalName:'music.wav',bytes:wave(2,1000,.3).length,duration:2,mime:'audio/wav',codec:'pcm_s16le',sampleRate:48000,channels:1,rightsDeclaredAt:new Date().toISOString()};
 const defaults={volume:.15,fadeIn:false,fadeInSeconds:1,fadeOut:false,fadeOutSeconds:.5,loop:true,ducking:false};
 const amplitude=(file,start,span=.2)=>{
   const data=ff(['-i',file,'-ss',String(start),'-t',String(span),'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-']);let sin=0,cos=0;
   for(let i=0;i<data.length/4;i++){const value=data.readFloatLE(i*4),angle=2*Math.PI*1000*i/48000;sin+=value*Math.sin(angle);cos+=value*Math.cos(angle);}return 2*Math.hypot(sin,cos)/(data.length/4);
 };
 const mix=async(options={},music=metadata)=>{
   const dir=fs.mkdtempSync(join(root,'mix-case-'));
   const output=await musicRenderer.prepare({audio:{duration:6},music,musicSettings:{...defaults,...options}},narration,dir,new AbortController().signal);
   const probe=JSON.parse(spawnSync(renders.ffprobePath,['-v','error','-show_entries','format=duration','-of','json',output]).stdout.toString());assert.ok(Math.abs(Number(probe.format.duration)-6)<.025);return output;
 };
 let output=await mix({volume:0});assert.equal(output,narration);assert.ok(amplitude(output,.8)<.001);
 output=await mix();const level15=amplitude(output,.8);assert.ok(level15>.03&&level15<.06);assert.ok(amplitude(output,3)>.03);assert.ok(amplitude(output,5)>.03);
 output=await mix({volume:1});assert.ok(amplitude(output,.8)>level15*5);const samples=ff(['-i',output,'-f','f32le','-ac','1','-']);let peak=0;for(let i=0;i<samples.length;i+=4)peak=Math.max(peak,Math.abs(samples.readFloatLE(i)));assert.ok(peak<=.851);
 output=await mix({loop:false});assert.ok(amplitude(output,.8)>.03);assert.ok(amplitude(output,3)<.001);assert.ok(amplitude(output,5)<.001);
 output=await mix({fadeIn:true,fadeOut:true});assert.ok(amplitude(output,.05,.1)<level15*.3);assert.ok(amplitude(output,5.85,.1)<level15*.35);
 output=await mix({loop:false,fadeOut:true});assert.ok(amplitude(output,1.85,.1)<level15*.35);
 output=await mix({ducking:true});assert.ok(amplitude(output,.8)<level15*.7);assert.ok(amplitude(output,3.3)>amplitude(output,.8)*1.5);
 const longKey='long-music.wav',long=wave(10,1000,.3);await storage.save(longKey,long);output=await mix({loop:true},{...metadata,key:longKey,bytes:long.length,duration:10});assert.ok(amplitude(output,5)>.03);
 console.log('PASS: trilha sonora: seis formatos, direitos, MIME/conteúdo, limites, revisão, acesso, preview, substituição/remoção, persistência, render com/sem música, duração, volume 0/15/100%, clipping, loop/silêncio, fades e ducking medidos em áudio real.');
};
