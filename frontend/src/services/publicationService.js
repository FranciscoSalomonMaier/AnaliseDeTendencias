const API=(import.meta.env.VITE_API_URL??'').replace(/\/$/,'');
export const publicationUrl=path=>API+path;
async function request(path,method='GET',body){let response;try{response=await fetch(API+path,{method,credentials:'include',headers:body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}catch{throw new Error('Não foi possível conectar à preparação de publicação.');}const data=await response.json();if(!response.ok){const error=new Error(typeof data.message==='string'?data.message:'Operação de publicação inválida.');error.status=response.status;error.issues=data.issues;throw error;}return data;}
const base=id=>`/content-projects/${encodeURIComponent(id)}/publication`;
export const publications={
 login:key=>request('/content-access/session','POST',{key}),
 get:id=>request(base(id)),save:(id,state)=>request(base(id),'PATCH',{revision:state.revision,data:state.data}),
 generate:(id,revision,kind,count=3)=>request(base(id)+'/generate','POST',{revision,kind,count}),
 chapters:(id,revision)=>request(base(id)+'/chapters','POST',{revision}),
 upload:(id,file,overlay)=>{const form=new FormData();form.append('file',file);form.append('overlay',JSON.stringify(overlay));return request(base(id)+'/thumbnails/upload','POST',form);},
 compose:(id,thumbId,overlay)=>request(base(id)+`/thumbnails/${thumbId}/compose`,'POST',overlay),
};
