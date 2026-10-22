import fs from "node:fs";
import path from "node:path";
import {readStore,mutateStore,newId,nowISO,dirs,appendLog} from "./store";
import {atomicWrite} from "./atomic-file";
import {assert} from "./errors";
import {kdocsClient,kdocsConnected,type KdocsSheet,type KdocsCell} from "./kdocs";
import {kdocsRows,kdocsText,suggestKdocsMapping,parseKdocsSheet,kdocsNormalize} from "./kdocs-data";
import {PERFORMANCE_RULES} from "./performance-rules";
import {digest,normalized} from "./team-sheet-data";
import type {Task,KdocsState,KdocsMapping,PerformanceEntry} from "./types";
type Client=ReturnType<typeof kdocsClient>;
type Snapshot={sheet:KdocsSheet;cells:KdocsCell[]};
const global=globalThis as typeof globalThis&{__kdocsJob?:{running?:Promise<void>;timer?:ReturnType<typeof setTimeout>;worker?:ReturnType<typeof setInterval>}};const job=global.__kdocsJob??={};
export async function kdocsSnapshots(client:Client,url:string){
 const info=await client.info(url);assert(Array.isArray(info.sheetsInfo),"金山文檔回應沒有表格頁籤",502);const snapshots:Snapshot[]=[];
 for(const sheet of info.sheetsInfo.filter(s=>s.isVisible!==false&&["et","db"].includes(s.sheetType))){
  assert(sheet.rowTo<=5000&&sheet.colTo<100,"工作概覽超出同步上限（5000 行、100 欄）");const cells:KdocsCell[]=[];
  for(let row=Math.max(0,sheet.rowFrom);row<=sheet.rowTo;row+=100){const d=await client.read(url,sheet.sheetId,row,Math.min(row+99,sheet.rowTo),0,sheet.colTo);assert(Array.isArray(d.detail?.rangeData),"原表內容格式無法辨識",502);cells.push(...d.detail.rangeData);}
  snapshots.push({sheet,cells});
 }
 assert(snapshots.length,"這份連結沒有可讀取的普通表格頁籤，請先確認文件類型及帳號權限");return snapshots;
}
const taskContent=(t:Task)=>digest([t.title,t.department,t.matterId,t.memberIds,t.assignee,t.workDate,t.status,t.note]);
export async function pullKdocs(client:Client,config:KdocsState){
 const snapshots=await kdocsSnapshots(client,config.url),old=readStore();
 const directory=path.join(dirs.root,"integrations","kdocs");fs.mkdirSync(directory,{recursive:true,mode:0o700});atomicWrite(path.join(directory,"latest-snapshot.json"),JSON.stringify({at:nowISO(),snapshots}));
 const mappings=[...config.mappings];for(const {sheet,cells}of snapshots)if(!mappings.some(m=>m.sheetId===sheet.sheetId)&&!config.sheets.some(s=>s.id===sheet.sheetId)){const suggested=suggestKdocsMapping(sheet.sheetId,cells);if(suggested)mappings.push(suggested);}
 const issues:string[]=[],records:ReturnType<typeof parseKdocsSheet>["records"]=[];
 for(const {sheet,cells}of snapshots){const mapping=mappings.find(m=>m.sheetId===sheet.sheetId);if(!mapping){if(sheet.sheetType==="db"&&!cells.some(c=>c.rowFrom===0&&/^(工作事项|工作事項|任务|任務|事项|事項)$/.test(kdocsText(c))))continue;issues.push(`${sheet.sheetName}：尚未確認姓名與工作欄位，原表保留，請在連接設定選擇欄位。`);continue;}
  const excluded=new Set<number>();for(const link of Object.values(old.kdocs?.publications||{}).flat().filter(p=>p.owned&&p.sheetId===sheet.sheetId)){
   const positions=[...new Set(cells.map(c=>c.rowFrom))].filter(row=>link.recordId?cells.some(c=>c.rowFrom===row&&c.recordId===link.recordId):[link.after,link.previous].some(pattern=>pattern?.some(c=>c.value)&&pattern.every(v=>kdocsText(cells.find(c=>c.rowFrom===row&&c.colFrom===v.col))===v.value)));
   if(positions.length===1)excluded.add(positions[0]);else excluded.add(link.row);
  }
  const parsed=parseKdocsSheet(sheet,cells.filter(c=>!excluded.has(c.rowFrom)),mapping,old.members,config.year);records.push(...parsed.records);issues.push(...parsed.issues);
 }
 await mutateStore(s=>{
  assert(s.kdocs?.url===config.url,"行政部表格設定已改動，請重試",409);const state=s.kdocs,seen=new Set<string>(),perfSeen=new Set<string>(),stamp=nowISO();
  state.mappings=mappings;state.sheets=snapshots.map(({sheet,cells})=>{const rows=kdocsRows(cells),mapping=mappings.find(m=>m.sheetId===sheet.sheetId),header=rows.get(mapping?.headerRow??0);return{id:sheet.sheetId,name:sheet.sheetName,columns:Array.from({length:sheet.colTo+1},(_,col)=>({col,label:header?.get(col)||`第 ${col+1} 欄`})),sample:[...rows].sort((a,b)=>a[0]-b[0]).slice(0,8).map(([,r])=>Array.from({length:Math.min(sheet.colTo+1,12)},(_,col)=>r.get(col)||""))};});
  for(const r of records){
   const existing=s.tasks.find(t=>t.sourceRefs?.includes(r.key)||!r.recordId&&!t.kdocsOrigin?.recordId&&t.kdocsOrigin?.sheetId===r.sheetId&&t.kdocsOrigin.row===r.row&&t.memberIds?.some(id=>r.memberIds.includes(id)));const key=existing?.sourceRefs?.find(ref=>ref.startsWith("kd:record:"))||r.key;seen.add(key);
   let matter=s.matters.find(m=>m.department==="行政部"&&kdocsNormalize(m.title)===kdocsNormalize(r.matter));if(!matter){matter={id:newId("matter"),title:r.matter,department:"行政部",note:"由行政部工作概覽同步",createdAt:stamp,updatedAt:stamp};s.matters.push(matter);}
   const next:Task={id:existing?.id||`kd_task_${digest(key)}`,title:r.title,department:"行政部",matterId:matter.id,memberIds:r.memberIds,assignee:r.names.join("、"),workDate:r.date,due:r.date||undefined,status:r.taskStatus,sourceRecorded:r.taskStatus==="done",reviewRequired:false,priority:"normal",note:[r.note,`來源：${r.sheetName} · 第 ${r.row+1} 行`].filter(Boolean).join("\n"),sourceRefs:[key],kdocsOrigin:{sheetId:r.sheetId,row:r.row,recordId:r.recordId,fingerprint:r.fingerprint,projectId:r.projectId},createdAt:existing?.createdAt||stamp,updatedAt:stamp};
   if(!existing){s.tasks.push(next);state.importHashes[next.id]=taskContent(next);}
   else{existing.kdocsOrigin=next.kdocsOrigin;existing.sourceMissing=false;if(!state.importHashes[existing.id]||taskContent(existing)===state.importHashes[existing.id]){const before=taskContent(existing);Object.assign(existing,next,{updatedAt:before===taskContent(next)?existing.updatedAt:stamp});state.importHashes[existing.id]=taskContent(existing);}else issues.push(`${r.sheetName} · ${r.title}：保留你在工作台修改的版本，請核對原表變動。`);}
   if(!r.rule){issues.push(`${r.sheetName}：尚未確認績效項目，只同步工作任務，沒有自動計次。`);continue;}if(!r.date||!r.memberIds.length)continue;
   if(r.rule==="materials"&&!r.phase){issues.push(`${r.title}：物資工作尚未區分準備／收尾，保留任務，未自動計績效。`);continue;}
   for(const id of r.memberIds){const ref=`${key}:performance:${id}`,prior=s.performance.find(e=>e.sourceRef===ref);perfSeen.add(ref);if(state.suppressedRefs?.includes(ref))continue;
    const duplicate=s.performance.find(e=>!e.sourceRef&&e.memberId===id&&e.date===r.date&&e.title===r.title&&e.rule===r.rule);if(duplicate){issues.push(`${r.title}：已有相同成員、日期、項目的手動績效，沒有重複計次。`);continue;}
    if(r.rule==="materials"&&r.status==="done"&&s.performance.some(e=>e.id!==prior?.id&&e.memberId===id&&e.activity===r.matter&&e.rule==="materials"&&e.phase===r.phase&&e.status==="done"&&!e.sourceMissing)){issues.push(`${r.title}：同活動同階段物資工作已有一次紀錄，未重複計次。`);continue;}
    const entry:PerformanceEntry={id:prior?.id||`kd_perf_${digest(ref)}`,sourceRef:ref,sourceMissing:false,memberId:id,date:r.date,title:r.title,activity:r.matter,category:PERFORMANCE_RULES[r.rule].category,rule:r.rule,phase:r.phase,status:r.status,note:r.note,createdAt:prior?.createdAt||stamp};if(prior)Object.assign(prior,entry);else s.performance.push(entry);
   }
  }
  for(const t of s.tasks)if(t.sourceRefs?.some(r=>r.startsWith("kd:record:"))&&!t.sourceRefs.some(r=>seen.has(r)))t.sourceMissing=true;
  for(const p of s.performance)if(p.sourceRef?.startsWith("kd:")&&!perfSeen.has(p.sourceRef))p.sourceMissing=true;
  state.projects=mappings.flatMap(mapping=>{const source=snapshots.find(s=>s.sheet.sheetId===mapping.sheetId),link=source?.sheet.links?.find(l=>l.col===mapping.activityColumn),target=snapshots.find(s=>s.sheet.sheetId===link?.sheetId);if(!target||!link)return[];return target.cells.filter(c=>c.rowFrom>0&&c.colFrom===link.primaryColumn&&c.recordId&&kdocsText(c)).map(c=>({sheetId:mapping.sheetId,id:c.recordId!,title:kdocsText(c)}));});
  state.sourceRecords=records.map(r=>({key:r.key,title:r.title,names:r.names,date:r.date,score:r.score,category:r.sourceCategory,status:r.sourceStatus||r.taskStatus}));
  state.importedCount=records.length;state.performanceCount=s.performance.filter(p=>p.sourceRef?.startsWith("kd:")&&!p.sourceMissing).length;state.issues=[...new Set(issues)];state.lastPullAt=stamp;state.lastError=undefined;state.lastErrorAt=undefined;
  appendLog(s,"sync",`行政部工作概覽已核對 ${records.length} 項，按原頁籤／活動分類並按來源去重`);
 });
}
const kdocsHash=(t:Task,c:KdocsState,s=readStore())=>digest([t.title,t.note,t.memberIds?.map(id=>[id,s.members.find(m=>m.id===id)?.name]),t.status,t.workDate,t.due,t.kdocsReporting,c.mappings.find(m=>m.sheetId===t.kdocsReporting?.sheetId),s.matters.find(m=>m.id===t.matterId)?.title]);
export function pendingKdocs(s=readStore()){
 const c=s.kdocs;if(!c?.enabled)return 0;const tasks=s.tasks.filter(t=>t.department==="行政部"&&t.kdocsReporting?.include&&t.kdocsReporting.sheetId!==undefined&&!t.demo);
 return tasks.filter(t=>c.taskHashes[t.id]!==kdocsHash(t,c,s)).length+Object.keys(c.publications).filter(id=>!tasks.some(t=>t.id===id)).length;
}
type Values={col:number;value:string}[];
const sameValues=(a:Values,b:Values)=>JSON.stringify(a)===JSON.stringify(b);
const matches=(cells:KdocsCell[],row:number,want:Values)=>want.every(v=>kdocsText(cells.find(c=>c.rowFrom===row&&c.colFrom===v.col))===v.value);
export async function pushKdocs(client:Client,config:KdocsState){
 const s=readStore(),tasks=s.tasks.filter(t=>t.department==="行政部"&&t.kdocsReporting?.include&&t.kdocsReporting.sheetId!==undefined&&!t.demo);
 const changed=tasks.filter(t=>config.taskHashes[t.id]!==kdocsHash(t,config)),removed=Object.keys(config.publications).filter(id=>!tasks.some(t=>t.id===id));
 const active=()=>assert(readStore().kdocs?.url===config.url&&readStore().kdocs?.enabled,"同步設定已改動，已停止寫入",409);
 for(const id of [...changed.map(t=>t.id),...removed]){
  active();const task=tasks.find(t=>t.id===id);let links=structuredClone(readStore().kdocs?.publications[id]||[]);
  const save=async()=>{await mutateStore(store=>{active();store.kdocs!.publications[id]=structuredClone(links);});};
  const transition=(link:typeof links[number],after:Values)=>{
   if(sameValues(link.after,after))return;
   const accepted=[...(link.accepted||[link.previous||link.before]),link.after].filter((v,i,all)=>all.findIndex(x=>sameValues(x,v))===i);
   assert(accepted.length<=8,"多次未完成的回填需要先核對原表，已停止寫入",409);link.accepted=accepted;link.after=after;
  };
  const apply=async(link:typeof links[number])=>{
   active();const snapshots=await kdocsSnapshots(client,config.url),snap=snapshots.find(x=>x.sheet.sheetId===link.sheetId);assert(snap,"原表頁籤已移除，請重新選擇",409);
   const patterns=[link.after,...(link.accepted||[link.previous||link.before])];
   const positions=[...new Set(snap.cells.map(c=>c.rowFrom))].filter(row=>link.recordId?snap.cells.some(c=>c.rowFrom===row&&c.recordId===link.recordId):(!link.owned||link.attempted)&&!snap.cells.some(c=>c.rowFrom===row&&c.recordId&&link.priorRecordIds?.includes(c.recordId))&&patterns.some(p=>p.some(c=>c.value!=="")&&matches(snap.cells,row,p)));
   if(link.recordId)assert(positions.length===1,"原表的關聯記錄已被移除，已停止寫入",409);
   assert(positions.length<=1,"原表出現多筆相同記錄，已停止覆寫",409);if(positions.length===1)link.row=positions[0];
   assert(patterns.some(p=>matches(snap.cells,link.row,p)),"原表這筆資料已人工修改，已保留，請先核對",409);
   if(!matches(snap.cells,link.row,link.after)){
    assert(!snap.cells.some(c=>c.rowFrom<=link.row&&c.rowTo>=link.row&&link.after.some(v=>v.col>=c.colFrom&&v.col<=c.colTo)&&(c.fmlaText||c.isCellPic||c.rowFrom!==c.rowTo||c.colFrom!==c.colTo)),"目標欄位有公式、圖片或合併格，已停止覆寫",409);
    if(link.owned&&patterns.some(p=>p.every(c=>c.value==="")&&matches(snap.cells,link.row,p)))assert(!snap.cells.some(c=>c.rowFrom===link.row&&kdocsText(c)),"原定空白行已有其他內容，已停止寫入",409);
    link.attempted=true;await save();active();await client.write(config.url,link.sheetId,link.after.map(c=>({row:link.row,...c})));
   }
   const verify=await client.read(config.url,link.sheetId,link.row,link.row,0,99);assert(matches(verify.detail.rangeData,link.row,link.after),"原表寫入後核對失敗，重試會更新同一筆",502);link.recordId=verify.detail.rangeData.find(c=>c.recordId)?.recordId||link.recordId;link.previous=undefined;link.accepted=undefined;await save();
  };
  for(const link of [...links])if(!task||link.sheetId!==task.kdocsReporting!.sheetId){transition(link,link.before);await save();await apply(link);links=links.filter(l=>l!==link);await save();}
  if(task){
   const mapping=config.mappings.find(m=>m.sheetId===task.kdocsReporting!.sheetId);assert(mapping,"請先在行政部連接設定確認目標頁籤欄位",409);assert(task.memberIds?.length,"請先選擇執行成員");
   const names=task.memberIds.map(id=>s.members.find(m=>m.id===id&&m.department==="行政部")?.name);assert(names.every(Boolean),"執行成員已變動，請重新選擇行政部成員");
   const desired:Values=[{col:mapping.titleColumn,value:task.title},{col:mapping.memberColumn,value:names.join("、")},...(mapping.dateColumn!==undefined?[{col:mapping.dateColumn,value:task.workDate||task.due?.slice(0,10)||""}]:[]),...(mapping.activityColumn!==undefined?[{col:mapping.activityColumn,value:config.projects?.find(p=>p.sheetId===mapping.sheetId&&p.id===task.kdocsReporting?.projectId)?.title||s.matters.find(m=>m.id===task.matterId)?.title||""}]:[]),...((mapping.detailColumn??mapping.noteColumn)!==undefined?[{col:(mapping.detailColumn??mapping.noteColumn)!,value:(task.note||"").split("\n").filter(line=>!/^來源：.* · 第 \d+ 行$/.test(line)).join("\n")}]:[]),...(mapping.statusColumn!==undefined?[{col:mapping.statusColumn,value:task.status==="done"?"已完成":"进行中"}]:[])];
   let link=links.find(l=>l.sheetId===mapping.sheetId);
   if(!link){
    const all=await kdocsSnapshots(client,config.url),snapshot=all.find(x=>x.sheet.sheetId===mapping.sheetId);assert(snapshot,"原表頁籤已移除，請重新選擇",409);let row:number;const origin=task.kdocsOrigin;
    if(origin?.sheetId===mapping.sheetId){row=origin.recordId?snapshot.cells.find(c=>c.recordId===origin.recordId)?.rowFrom??-1:origin.row;assert(row>=0,"來源記錄已移除，請先重新讀取表格",409);assert(origin.fingerprint?digest(snapshot.cells.filter(c=>c.rowFrom===row).map(c=>[c.colFrom,kdocsText(c)]).sort((a,b)=>Number(a[0])-Number(b[0])))===origin.fingerprint:kdocsText(snapshot.cells.find(c=>c.rowFrom===row&&c.colFrom===mapping.titleColumn))===task.title,"來源行已有變動，請先重新讀取表格",409);}
    else{row=Math.max(mapping.headerRow,...snapshot.cells.filter(c=>kdocsText(c)||c.fmlaText||c.isCellPic).map(c=>c.rowTo))+1;assert(row<5000,"原表行數超出同步上限");}
    link={sheetId:mapping.sheetId,memberId:"all",row,owned:origin?.sheetId!==mapping.sheetId,recordId:snapshot.cells.find(c=>c.rowFrom===row&&c.recordId)?.recordId,priorRecordIds:[...new Set(snapshot.cells.map(c=>c.recordId).filter(Boolean) as string[])],before:desired.map(c=>({col:c.col,value:kdocsText(snapshot.cells.find(v=>v.rowFrom===row&&v.colFrom===c.col))})),after:desired};links.push(link);
   }else{
    // A mapping change must first restore the columns this task previously owned.
    const extra=link.after.filter(c=>!desired.some(v=>v.col===c.col)).map(c=>link!.before.find(v=>v.col===c.col)||{col:c.col,value:""});
    for(const c of desired)if(!link.before.some(v=>v.col===c.col)){
     const snapshot=(await kdocsSnapshots(client,config.url)).find(x=>x.sheet.sheetId===link!.sheetId);assert(snapshot,"原表頁籤已移除",409);link.before.push({col:c.col,value:kdocsText(snapshot.cells.find(v=>v.rowFrom===link!.row&&v.colFrom===c.col))});
    }
    transition(link,[...desired,...extra]);
   }
   await save();await apply(link);await mutateStore(store=>{active();store.kdocs!.taskHashes[id]=kdocsHash(task,config);});
  }else await mutateStore(store=>{if(store.kdocs){delete store.kdocs.publications[id];delete store.kdocs.taskHashes[id];}});
 }
 if(changed.length||removed.length)await mutateStore(s=>{if(s.kdocs){s.kdocs.lastPushAt=nowISO();s.kdocs.lastError=undefined;s.kdocs.lastErrorAt=undefined;}});
}
export async function runKdocs(mode:"all"|"pull"|"push"="all"){
 while(job.running)try{await job.running;}catch{}const config=readStore().kdocs;assert(config?.enabled,"請先連接並啟用行政部工作概覽");assert(kdocsConnected(),"金山文檔尚未完成官方授權");
 job.running=(async()=>{try{const client=kdocsClient();if(mode!=="pull")await pushKdocs(client,config);if(mode!=="push")await pullKdocs(client,readStore().kdocs!);}catch(e){await mutateStore(s=>{if(s.kdocs){s.kdocs.lastError=e instanceof Error?e.message:"行政部表格同步未完成";s.kdocs.lastErrorAt=nowISO();}});throw e;}})();try{await job.running;}finally{job.running=undefined;}
}
export function scheduleKdocs(){if(job.timer)clearTimeout(job.timer);job.timer=setTimeout(()=>{job.timer=undefined;if(readStore().kdocs?.enabled&&kdocsConnected()&&!job.running&&pendingKdocs())void runKdocs("push").catch(()=>{});},3000);job.timer.unref?.();}
export function startKdocsWorker(){if(job.worker||process.env.WORKBENCH_SKIP_SYNC==="true")return;job.worker=setInterval(()=>{const c=readStore().kdocs;if(!c?.enabled||!kdocsConnected()||job.running||c.lastErrorAt&&Date.now()-Date.parse(c.lastErrorAt)<1200000)return;const due=!c.lastPullAt||Date.now()-Date.parse(c.lastPullAt)>3600000;if(due||pendingKdocs())void runKdocs(due?"all":"push").catch(()=>{});},60000);job.worker.unref?.();}
