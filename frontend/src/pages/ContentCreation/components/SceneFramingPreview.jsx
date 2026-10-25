import { useEffect, useRef } from "react";
export function SceneFramingPreview({src, choice, aspectRatio}) {
 const canvasRef = useRef(null);
 useEffect(() => {
  let active = true;
  const image = new Image();
  image.onload = () => {
   if (!active || !canvasRef.current) return;
   const canvas = canvasRef.current, ctx = canvas.getContext('2d');
   const w = canvas.width, h = canvas.height, sw = image.naturalWidth, sh = image.naturalHeight;
   ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
   if (choice.fit === 'COVER') {
    const cw = Math.max(1,Math.floor(Math.min(sw,sh*w/h)/(choice.zoom??1))), ch = Math.max(1,Math.floor(Math.min(sh,sw*h/w)/(choice.zoom??1)));
    const x = Math.max(0,Math.min(sw-cw,Math.round(sw*(choice.focalX??0.5)-cw/2))), y = Math.max(0,Math.min(sh-ch,Math.round(sh*(choice.focalY??0.5)-ch/2)));
    ctx.drawImage(image,x,y,cw,ch,0,0,w,h);
   } else {
    if (choice.fit === 'BLURRED_BACKGROUND') { const f=Math.max(w/sw,h/sh);ctx.save();ctx.filter='blur(8px)';ctx.drawImage(image,(w-sw*f)/2,(h-sh*f)/2,sw*f,sh*f);ctx.restore(); }
    const f=Math.min(w/sw,h/sh);ctx.drawImage(image,(w-sw*f)/2,(h-sh*f)/2,sw*f,sh*f);
   }
  };
  image.src=src;
  return () => {active=false;};
 },[src,choice,aspectRatio]);
 return <figure><canvas aria-label="Prévia do enquadramento" ref={canvasRef} width={aspectRatio==='9:16'?270:480} height={aspectRatio==='9:16'?480:270} className="max-h-96 max-w-full rounded bg-black"/><figcaption className="text-xs text-muted-foreground">Recorte estático aproximado. Use a prévia animada para conferir o movimento final.</figcaption></figure>;
}
