import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import path from "node:path";
import {createInterface} from "node:readline";
import type {TextCell} from "./material-layout";

interface Result {cells?:TextCell[];text?:string;confidence?:number;engine:string}
interface Bridge {process?:ChildProcessWithoutNullStreams;pending?:{id:number;resolve:(value:Result)=>void;reject:(error:Error)=>void};tail:Promise<unknown>;next:number;idle?:ReturnType<typeof setTimeout>}
const global=globalThis as unknown as {__workbenchRapid?:Bridge};
const state=()=>global.__workbenchRapid??={tail:Promise.resolve(),next:0};
export const rapidConfigured=()=>!!process.env.WORKBENCH_OCR_PYTHON;
function worker(){
  const s=state();if(s.process)return s.process;
  const executable=process.env.WORKBENCH_OCR_PYTHON;if(!executable||!path.isAbsolute(executable))throw new Error("未設定本機 OCR Python 引擎");
  const child=spawn(executable,[path.join(process.cwd(),"scripts/ocr-worker.py")],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});s.process=child;
  child.stderr.on('data',()=>{});
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(line.length>2_000_000){child.kill();return;}try{const result=JSON.parse(line);if(result.id!==s.pending?.id)return;const pending=s.pending;if(!pending)return;s.pending=undefined;if(result.error)pending.reject(new Error("本機中文 OCR 未能讀取此文件"));else pending.resolve(result);}catch{/* Ignore dependency logging. */}});
  const close=()=>{if(s.process!==child)return;s.process=undefined;s.pending?.reject(new Error("本機中文 OCR 已中止，請重試"));s.pending=undefined;};child.once('error',close);child.once('exit',close);child.stdin.on('error',close);
  return child;
}
async function request(bytes:Buffer,mode:string):Promise<Result>{
  const s=state();clearTimeout(s.idle);
  const task=s.tail.catch(()=>{}).then(async()=>{
    clearTimeout(s.idle);const child=worker(),id=++s.next;let timeout:ReturnType<typeof setTimeout>|undefined;
    try{return await new Promise<Result>((resolve,reject)=>{s.pending={id,resolve,reject};timeout=setTimeout(()=>{s.process=undefined;child.kill();s.pending=undefined;reject(new Error("本機中文 OCR 超時，請拆分文件或重試"));},90_000);child.stdin.write(JSON.stringify({id,mode,data:bytes.toString('base64')})+'\n');});}
    finally{clearTimeout(timeout);s.idle=setTimeout(()=>{s.process?.kill();s.process=undefined;},45_000);s.idle.unref?.();}
  });s.tail=task;return task;
}
export const rapidRecognize=(bytes:Buffer)=>request(bytes,'ocr');
export const readLegacyExcel=(bytes:Buffer)=>request(bytes,'spreadsheet');
