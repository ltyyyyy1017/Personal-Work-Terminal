"use client";
import {useEffect} from "react";
export default function LiquidGlass(){
 useEffect(()=>{
  const motion=matchMedia("(prefers-reduced-motion: reduce)"),pointer=matchMedia("(hover: hover) and (pointer: fine)");
  let frame=0,active:HTMLElement|null=null,x=0,y=0;
  function move(event:PointerEvent){if(motion.matches||!pointer.matches)return;const target=(event.target as Element)?.closest<HTMLElement>(".panel,.stat-card,.modal");if(target!==active){active?.style.removeProperty("--glass-light");active=target||null;}if(!active)return;const bounds=active.getBoundingClientRect();x=Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100));y=Math.max(0,Math.min(100,(event.clientY-bounds.top)/bounds.height*100));if(!frame)frame=requestAnimationFrame(()=>{frame=0;active?.style.setProperty("--glass-light",`radial-gradient(380px circle at ${x}% ${y}%,rgba(255,255,255,.42),transparent 75%)`);});}
  document.addEventListener("pointermove",move,{passive:true});return()=>{document.removeEventListener("pointermove",move);cancelAnimationFrame(frame);active?.style.removeProperty("--glass-light");};
 },[]);
 return <div className="glass-ambient" aria-hidden="true"><i/><i/><i/></div>;
}
