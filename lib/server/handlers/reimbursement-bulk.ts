import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {readStore,mutateStore,dirs,newId,nowISO,appendLog} from "../../store";
import {assert} from "../../errors";
import {json,str} from "../http";
import {isReported} from "../../reimbursement-progress";
import {contentDisposition,resolveInside} from "../../files";
import {shortFileBase} from "../../naming";
import {traditional} from "../../export-traditional";
import {buildActivity} from "../../build";
import type {Ctx} from "../ctx";

const running=new Set<string>();
export async function bulk(ctx:Ctx){
 const b=await ctx.body<Record<string,unknown>>();
 assert(Array.isArray(b.ids)&&b.ids.length>0&&b.ids.length<=100,"請選擇 1–100 筆報銷");
 const ids=[...new Set(b.ids.map(String))];assert(ids.every(id=>/^[\w-]{1,100}$/.test(id)),"報銷編號不正確");
 const operation=str(b.operation);assert(["report","unreport","fund","unfund","associate","delete","export"].includes(operation),"請選擇有效的批量操作");
 if(operation==="export"){
   assert(ids.length<=30,"一次最多打包 30 筆報銷");assert(ids.every(id=>!running.has(id)),"選取的報銷正在打包，請稍候",409);ids.forEach(id=>running.add(id));
   try{
    const snapshot=readStore(),selected=ids.map(id=>snapshot.activities.find(a=>a.id===id));assert(selected.every(Boolean),"部分報銷已刪除，請重新選擇",409);
    const records=selected.filter(a=>!!a);assert(records.every(a=>a.items.length&&a.files.length),"部分報銷尚未上傳材料或填寫費用，請先補齊");assert(records.reduce((n,a)=>n+a.files.reduce((s,f)=>s+f.size,0),0)<=100*1024*1024,"選取的材料超過 100 MB，請分批打包");
    const zip=new JSZip();let bytes=0;
    for(const [index,a]of records.entries()){
      const {output}=await buildActivity(a.id);const current=readStore().activities.find(r=>r.id===a.id);assert(current,"報銷在打包期間已刪除，請重試",409);
      const file=resolveInside(dirs.root,path.join(output.dir,output.zipName)),data=fs.readFileSync(file);bytes+=data.length;assert(bytes<=128*1024*1024,"生成材料超過 128 MB，請分批打包");
      zip.file(`${String(index+1).padStart(2,"0")}_報銷人-${shortFileBase(traditional(a.submitter||"未填寫"),55)}_${shortFileBase(traditional(a.name),90)}.zip`,data);
    }
    return new Response(new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"})),{headers:{"content-type":"application/zip","content-disposition":contentDisposition(`批量報銷材料_${records.length}筆.zip`),"cache-control":"no-store"}});
   }finally{ids.forEach(id=>running.delete(id));}
 }
 assert(ids.every(id=>!running.has(id)),"部分報銷正在打包，請稍候",409);
 // Move deleted material into a private recovery folder before removing database records.
 const moved:{from:string;to:string}[]=[];const recovery=operation==="delete"?path.join(dirs.root,"trash","reimburse",newId("batch")):undefined;
 try{
 const {result}=await mutateStore(s=>{
   const selected=ids.map(id=>s.activities.find(a=>a.id===id));assert(selected.every(Boolean),"部分報銷已刪除，請重新選擇",409);const records=selected.filter(a=>!!a);
   if(operation==="fund")assert(records.every(isReported),"先將全部選取的報銷標記為已上報，再登記批款");
   const matterId=str(b.matterId,"",100),matter=operation==="associate"&&matterId?s.matters.find(m=>m.id===matterId):undefined;
   if(operation==="associate"&&matterId)assert(matter&&records.every(a=>a.department===matter.department),"關聯事項必須與全部選取的報銷屬於同一部門");
   if(operation==="delete"){
     assert(b.confirm===true,"請先確認批量刪除");assert(recovery,"回收目錄未建立");fs.mkdirSync(recovery,{recursive:true,mode:0o700});
     for(const a of records)for(const [kind,base]of [["materials",dirs.reimburse],["exports",dirs.exports]]as const){const from=resolveInside(base,a.id),to=path.join(recovery,`${a.id}-${kind}`);if(fs.existsSync(from)){fs.renameSync(from,to);moved.push({from,to});}}
     fs.writeFileSync(path.join(recovery,"records.json"),JSON.stringify({deletedAt:nowISO(),records}),{mode:0o600,flag:"wx"});s.activities=s.activities.filter(a=>!ids.includes(a.id));
   }else for(const a of records){
     a.reported=isReported(a);
     if(operation==="report")a.reported=true;
     if(operation==="unreport"){a.reported=false;a.fundingStatus="unpaid";}
     if(operation==="fund")a.fundingStatus="paid";
     if(operation==="unfund")a.fundingStatus="unpaid";
     if(operation==="associate")a.matterId=matterId||undefined;
     // Previously generated files no longer represent the updated metadata.
     a.output=null;a.status="draft";a.updatedAt=nowISO();
   }
   appendLog(s,"reimburse",`批量報銷操作 ${operation}：${ids.length} 筆`);return {count:records.length};
 });return json({ok:true,...result});
 }catch(e){for(const move of moved.reverse())if(fs.existsSync(move.to)&&!fs.existsSync(move.from))fs.renameSync(move.to,move.from);throw e;}
}
