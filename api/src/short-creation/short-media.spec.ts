jest.mock('@nestjs/config',()=>({ConfigService:class{}}));
import { ShortMedia } from './short.media';
import type { ShortProject,ShortFile } from './short.schema';
describe('Short scene sampling',()=>{
 test('visual evidence used for ranking stays inside the selected center cuts',async()=>{
  const analysis={cuts:jest.fn().mockResolvedValue([]),frames:jest.fn(async(_path,_dir,sample)=>[{timestamp:(sample.start+sample.end)/2,data:Buffer.from('mock')}])};
  const vision={scene:jest.fn().mockResolvedValue({data:{description:'Detalhe visível no centro.',relevance:80},usage:{totalTokens:2}})};
  const settings={maxScenes:6,scanSeconds:60};
  const profiles={profile:()=>({interval:15,minSegment:2,maxSegments:6,maxFrames:18,framesPerSegment:3,cuts:false})};
  const media=new ShortMedia(settings as never,{} as never,{} as never,{} as never,analysis as never,profiles as never,vision as never,{} as never);
  jest.spyOn(media,'workspace').mockImplementation(async(_bytes,fn)=>fn('/tmp/mock'));
  jest.spyOn(media,'local').mockResolvedValue('/tmp/mock/source.mp4');
  const project={description:'Um tema',data:{narrationText:'Um detalhe',audio:{duration:5}}} as ShortProject;
  const result=await media.plan(project,[{id:'source',duration:20,bytes:'100'} as ShortFile],true,new AbortController().signal,async()=>{},async()=>{});
  expect(result.clips).toHaveLength(1);
  const clip=result.clips[0],sample=analysis.frames.mock.calls[0][2];
  expect(sample.start).toBeGreaterThanOrEqual(clip.start);
  expect(sample.end).toBeLessThanOrEqual(clip.end);
  expect(vision.scene.mock.calls[0][2]).toEqual(sample);
 });
});
