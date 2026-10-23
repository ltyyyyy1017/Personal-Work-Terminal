import {syncNativeTask} from "./team-sheet-native";
import fs from "node:fs";
import path from "node:path";
import {readStore,mutateStore,newId,nowISO,dirs,appendLog} from "./store";
import {atomicWrite} from "./atomic-file";
import {assert,AppError} from "./errors";
import {tencentClient,tencentConnected,type SheetCell,type SheetInfo} from "./tencent-docs";
import {parseAssignments,parseVolunteer,digest,sheetRows,cellValue,normalized,taskSyncPayload,type SheetSnapshot} from "./team-sheet-data";
import type {TeamSheetState,Task,Store,SyncedVolunteer} from "./types";
import {mergeSourceTask,scopeSourceParticipants,sourceConflictLabels} from "./source-task";

const taskHeader=["序號","時間","任務","姓名","聯繫方式","完成情況","事項","工作台編號","任務ID","成員ID","志願時錄入","同步校驗","更新時間"];
const hoursHeader=["序號","姓名","任務","線上出工時長","線下出工時長","匯總志願時長/h","錄入情況","日期","任務ID","工作台編號","事項","同步校驗","更新時間"];
type Client=Awaited<ReturnType<typeof tencentClient>>;
type JobState={running?:Promise<void>;timer?:ReturnType<typeof setTimeout>};
const global=globalThis as typeof globalThis&{__teamSheetJob?:JobState};const job=global.__teamSheetJob??={};
const valueCell=(row:number,col:number,value:string|number):SheetCell=>typeof value==="number"?{row,col,value_type:"NUMBER",number_value:value}:{row,col,value_type:"STRING",string_value:value};
async function readSheet(client:Client,file:string,sheet:SheetInfo){assert(sheet.row_count<=5000&&sheet.col_count<=200,"表格過大，請調整同步範圍");const cells:SheetCell[]=[];for(let start=0;start<sheet.row_count;start+=250){const d=await client.read(file,sheet.sheet_id,Math.min(sheet.row_count-1,start+249),Math.min(sheet.col_count-1,30),start);cells.push(...d.cells);}return {sheet,cells};}
export async function pullTeamSheets(client:Client,config:TeamSheetState){
 const taskInfo=await client.info(config.taskFileId),hourInfo=await client.info(config.hoursFileId),taskSnapshots:SheetSnapshot[]=[],hourSnapshots:SheetSnapshot[]=[];
 for(const s of taskInfo.sheets)if(s.sheet_type==="worksheet"&&!s.hidden&&!/基准模板|基準模板/.test(s.sheet_name))taskSnapshots.push(await readSheet(client,config.taskFileId,s));
 for(const s of hourInfo.sheets)if(s.sheet_type==="worksheet"&&!s.hidden&&!/基准模板|基準模板/.test(s.sheet_name))hourSnapshots.push(await readSheet(client,config.hoursFileId,s));
 const folder=path.join(dirs.root,"integrations","tencent-docs");fs.mkdirSync(folder,{recursive:true,mode:0o700});atomicWrite(path.join(folder,"latest-snapshot.json"),JSON.stringify({at:nowISO(),taskSnapshots,hourSnapshots}));
 const current=readStore();
 // Exclude only rows added by this workbench. Adopted original rows remain sources.
 const locations=new Map<string,number>();
 const sourceSnapshots=(list:SheetSnapshot[],file:string)=>list.map(snapshot=>{
  const excluded=new Set<number>(),rows=sheetRows(snapshot.cells);
  for(const [taskId,links]of Object.entries(current.teamSheets?.nativeLinks||{}))for(const link of links)if(link.file===file&&link.sheet===snapshot.sheet.sheet_id){
   const match=[...rows].filter(([,r])=>link.after.every(c=>(r.get(c.col)??"")===c.value));const row=match.length===1?match[0][0]:link.row;
   locations.set(`${taskId}:${link.kind}:${link.memberId}:${link.sheet}`,row);if(link.owned)excluded.add(row);
  }
  return {...snapshot,cells:snapshot.cells.filter(c=>!excluded.has(c.row))};
 });
 const assignments=parseAssignments(sourceSnapshots(taskSnapshots,config.taskFileId),config.taskFileId,config.department,current.members,config.academicYear,config.taskSheetId),volunteers=parseVolunteer(sourceSnapshots(hourSnapshots,config.hoursFileId),config.hoursFileId,config.department,current.members,config.academicYear,assignments,config.hoursSheetId);
 await mutateStore(s=>{
  assert(s.teamSheets?.taskFileId===config.taskFileId&&s.teamSheets.hoursFileId===config.hoursFileId,"同步設定已改動，請重試",409);
  for(const [taskId,links]of Object.entries(s.teamSheets.nativeLinks||{}))for(const link of links){const row=locations.get(`${taskId}:${link.kind}:${link.memberId}:${link.sheet}`);if(row!==undefined)link.row=row;}
  const assignmentKey=(a:typeof assignments[number])=>{
   const exact=s.tasks.find(t=>t.sourceRefs?.includes(a.key));if(exact)return a.key;
   const candidates=s.tasks.filter(t=>t.sheetOrigin?.task?.sheetId===a.sheetId&&t.sourceRefs?.some(r=>r.startsWith("td:assignment:"))&&a.memberIds.some(id=>t.memberIds?.includes(id)&&a.sourceRows?.[id]!==undefined&&((t.sheetOrigin!.task!.sourceRows?.[id]??t.sheetOrigin!.task!.rows?.[id]??t.sheetOrigin!.task!.row)===a.sourceRows[id])));
   const prior=candidates.length===1?candidates[0]:undefined;
   return prior?.sourceRefs?.find(r=>r.startsWith("td:assignment:"))||a.key;
  };
  const items:{key:string;matter:string;task:Omit<Task,"id"|"createdAt"|"updatedAt"|"matterId">}[]=assignments.map(a=>({key:assignmentKey(a),matter:a.matter,task:{title:a.title,department:config.department,memberIds:a.memberIds,assignee:a.names.join("、"),due:a.date||undefined,workDate:a.date,status:"done",sourceRecorded:true,reviewRequired:false,priority:"normal",note:`來源：團學任務分工 · ${a.matter}\n原表狀態：${a.done?"已完成":"已有紀錄，視為已通過"}\n${a.phase||""}`,sourceRefs:[assignmentKey(a),...a.refs],sheetOrigin:a.sheetId?{task:{sheetId:a.sheetId,row:Object.values(a.sourceRows||a.rows||{})[0]??0,rows:a.rows,sourceRows:a.sourceRows}}:undefined}}));
  for(const r of volunteers.records)if(!r.localTaskId){
   const prior=s.tasks.find(t=>t.sourceRefs?.includes(r.id))||s.tasks.find(t=>t.sheetOrigin?.hours?.sheetId===r.sheetId&&t.sheetOrigin?.hours?.row===r.row&&t.memberIds?.includes(r.memberId!)&&t.sourceRefs?.some(ref=>ref.startsWith("td:hours-task:")));
   const key=prior?.sourceRefs?.find(ref=>ref.startsWith("td:hours-task:"))||`td:hours-task:${r.id}`;items.push({key,matter:r.matterTitle,task:{title:(r.detail.replace(/\d+(?:\.\d+)?\s*(?:h|小时|小時)/gi,"").trim()||`${r.matterTitle} · 出工記錄`).slice(0,180),department:config.department,memberIds:r.memberId?[r.memberId]:[],assignee:r.name,workDate:r.date,due:r.date||undefined,status:"done",sourceRecorded:true,reviewRequired:false,priority:"normal",note:`來源：志願時匯總 · ${r.matterTitle}\n原表姓名：${r.name}\n${r.detail}\n來源時長僅供參考，需確認後才計入。`.slice(0,500),sourceRefs:[key,...r.sourceRefs],sourceHours:r.hours===null||!r.memberId?undefined:{[r.memberId]:r.hours},sheetOrigin:r.sheetId&&r.row!==undefined?{hours:{sheetId:r.sheetId,row:r.row}}:undefined}});
  }
  const stamp=nowISO(),seen=new Set(items.map(a=>a.key)),conflicts:string[]=[];let added=0;
  s.teamSheets.importHashes??={};
  for(const a of items){
   let matter=s.matters.find(m=>m.department===config.department&&normalized(m.title)===normalized(a.matter));if(!matter){matter={id:newId("matter"),title:a.matter,department:config.department,note:"按原表頁籤分類匯入",createdAt:stamp,updatedAt:stamp};s.matters.push(matter);}
   const existing=s.tasks.find(t=>t.sourceRefs?.includes(a.key));
   if(existing?.sourceMissing){existing.sourceMissing=false;existing.updatedAt=stamp;}
   if(existing)existing.sheetOrigin=a.task.sheetOrigin;
   const item:Task={...a.task,id:existing?.id||`td_task_${digest(a.key)}`,matterId:matter.id,sourceMissing:false,createdAt:existing?.createdAt||stamp,updatedAt:existing?.updatedAt||stamp};
   const content=(t:Task)=>{const {updatedAt,createdAt,organization,sourceMissing,sheetOrigin,sourceBaseline,...rest}=t;return digest(rest);},legacy=(t:Task)=>{const {updatedAt,createdAt,...rest}=t;return digest(rest);},nextHash=content(item),last=s.teamSheets.importHashes[item.id],canUpdate=!existing||!last||[content(existing),legacy(existing),legacy({...existing,organization:undefined})].includes(last.local);
   if(existing){const changed=mergeSourceTask(existing,item,canUpdate);existing.sourceRefs=[...new Set([...(existing.sourceRefs||[]),...(item.sourceRefs||[])])];if(changed.length)conflicts.push(`${a.matter} · ${a.task.title}：${sourceConflictLabels(changed)} 有本機及來源變動，已保留本機欄位，其他欄位繼續更新。`);}
   else{mergeSourceTask(item,{...item},true);s.tasks.push(item);added++;}
   if(existing&&!existing.sourceRecorded){existing.status="done";existing.reviewRequired=false;existing.sourceRecorded=true;existing.note=existing.note?.replace("已完成，待工作台確認","已通過");}
   scopeSourceParticipants(existing||item,s.members);
   s.teamSheets.importHashes[item.id]={local:content(existing||item),source:nextHash};
  }
  for(const t of s.tasks)if(t.sourceRefs?.some(r=>r.startsWith("td:assignment:")||r.startsWith("td:hours-task:"))&&!t.sourceRefs.some(r=>seen.has(r)))t.sourceMissing=true;
  s.teamSheets.volunteers=volunteers.records;s.teamSheets.issues=[...volunteers.issues,...conflicts];s.teamSheets.importedCount=items.length;s.teamSheets.lastPullAt=stamp;s.teamSheets.lastError=undefined;s.teamSheets.lastErrorAt=undefined;
  if(added)appendLog(s,"sync",`團學分工匯入 ${added} 項，按原表頁籤分類；來源時長僅供參考，確認前不計入統計`);
 });
}
async function managedSheet(client:Client,config:TeamSheetState,kind:"task"|"hours"){
 const field=kind==="task"?"taskSheetId":"hoursSheetId",file=kind==="task"?config.taskFileId:config.hoursFileId,header=kind==="task"?taskHeader:hoursHeader,info=await client.info(file);let sheet=info.sheets.find(s=>s.sheet_id===readStore().teamSheets?.[field]);
 const base=`工作台同步·${config.department}`.slice(0,27);
 if(!sheet){
  // Recover an already-created integration tab only when all header cells match.
  for(const candidate of info.sheets.filter(s=>s.sheet_name.startsWith(base))){const d=await client.read(file,candidate.sheet_id,0,12);const row=sheetRows(d.cells).get(0);if(row&&header.every((h,i)=>row.get(i)===h)){sheet=candidate;break;}}
  assert(sheet,"舊同步分表已不存在；請在任務通過頁選擇原有頁籤，不會自動新建分表",409);
  const selected=sheet;await mutateStore(s=>{assert(s.teamSheets,"請先設定同步");s.teamSheets[field]=selected.sheet_id;});config[field]=sheet.sheet_id;
 }
 const d=await client.read(file,sheet.sheet_id,0,12),row=sheetRows(d.cells).get(0);
 if(!row||[...row.values()].every(v=>v==="")){await client.write(file,sheet.sheet_id,header.map((v,i)=>valueCell(0,i,v)));}
 else assert(header.every((h,i)=>row.get(i)===h),"工作台同步分表的欄位已被改動，已停止寫入以保護資料",409);
 return {file,sheet,header};
}
function legacyEligibleTasks(s:Store){const c=s.teamSheets;return !c?[]:s.tasks.filter(t=>t.department===c.department&&!t.demo&&!t.sheetDestination&&!t.sourceRefs?.some(r=>r.startsWith("td:"))&&t.createdAt>=c.enabledAt&&t.reportToTeamSheets!==false&&Object.hasOwn(c.taskHashes,t.id));}
function taskHash(s:Store,t:Task){return digest([t.sheetDestination,taskSyncPayload(t,s.members,s.matters.find(m=>m.id===t.matterId)?.title||t.activityName||"未分類事項")]);}
export function eligibleTasks(s:Store){return [...legacyEligibleTasks(s),...s.tasks.filter(t=>t.department===s.teamSheets?.department&&t.reportToTeamSheets===true&&t.sheetDestination&&!t.demo)];}
export function pendingTeamTasks(s=readStore()){const c=s.teamSheets;if(!c?.enabled)return 0;const tasks=eligibleTasks(s);return tasks.filter(t=>t.sheetDestination&&c.taskHashes[t.id]!==taskHash(s,t)).length+[...new Set([...Object.keys(c.taskHashes),...Object.keys(c.nativeLinks||{})])].filter(id=>!tasks.some(t=>t.id===id)).length;}
/** Legacy tabs are frozen. Only explicit removal/migration clears owned keys. */
async function cleanupLegacySheets(client:Client,config:TeamSheetState){
 const before=readStore(),kept=legacyEligibleTasks(before),removed=Object.keys(config.taskHashes).filter(id=>!before.teamSheets?.nativeLinks?.[id]&&!kept.some(t=>t.id===id));
 if(!removed.length)return;
 for(const kind of ["task","hours"]as const){
  const target=await managedSheet(client,config,kind),snapshot=await readSheet(client,target.file,target.sheet),rows=sheetRows(snapshot.cells),keyCol=kind==="task"?7:9,cleared:string[]=[];const values:SheetCell[]=[];
  for(const [row,cells]of rows){if(!row)continue;const key=String(cells.get(keyCol)||""),taskId=String(cells.get(8)||"");if(!key.startsWith("wb:")||!removed.includes(taskId))continue;
   const old=Array.from({length:13},(_,i)=>cells.get(i) as string|number??"");assert(!snapshot.cells.some(c=>c.row===row&&c.formula)&&digest(old.slice(0,11))===old[11],"舊同步分表有人工改動，原值已保留；請核對後再遷移這項任務",409);
   for(let col=0;col<13;col++)values.push(valueCell(row,col,""));cleared.push(key);
  }
  for(let offset=0;offset<values.length;offset+=390)await client.write(target.file,target.sheet.sheet_id,values.slice(offset,offset+390));
  if(cleared.length){const check=await readSheet(client,target.file,target.sheet);assert(!check.cells.some(c=>c.col===keyCol&&cleared.includes(String(cellValue(c)))),"舊分表清理後核對未通過，重試不會重複新增",502);}
 }
 await mutateStore(s=>{if(s.teamSheets)for(const id of removed)delete s.teamSheets.taskHashes[id];});
}

export async function pushTeamSheets(client:Client,config:TeamSheetState){
 // Finish cleanup in legacy tabs before migrating an opted-in task to original pages.
 await cleanupLegacySheets(client,config);
 const before=readStore(),tasks=before.tasks.filter(t=>t.department===config.department&&t.reportToTeamSheets===true&&t.sheetDestination&&!t.demo);
 const changed=tasks.filter(t=>before.teamSheets?.taskHashes[t.id]!==taskHash(before,t)),removed=Object.keys(before.teamSheets?.nativeLinks||{}).filter(id=>!tasks.some(t=>t.id===id));
 for(const t of changed){await syncNativeTask(client,config,t,t.id);await mutateStore(s=>{assert(s.teamSheets,"同步設定不存在");s.teamSheets.taskHashes[t.id]=taskHash(before,t);});}
 for(const id of removed){await syncNativeTask(client,config,undefined,id);await mutateStore(s=>{if(s.teamSheets)delete s.teamSheets.taskHashes[id];});}
 if(changed.length||removed.length)await mutateStore(s=>{if(s.teamSheets){s.teamSheets.lastPushAt=nowISO();s.teamSheets.lastError=undefined;s.teamSheets.lastErrorAt=undefined;}});
}
export async function runTeamSheetSync(mode:"all"|"pull"|"push"="all"){
 while(job.running)try{await job.running;}catch{/* A later request can retry a failed run. */}
 const config=readStore().teamSheets;assert(config?.enabled,"請先設定並啟用團學表格同步");assert(tencentConnected(),"請先授權騰訊文檔");
 job.running=(async()=>{try{const client=await tencentClient();if(mode!=="push")await pullTeamSheets(client,readStore().teamSheets!);if(mode!=="pull")await pushTeamSheets(client,readStore().teamSheets!);}catch(e){await mutateStore(s=>{if(s.teamSheets){s.teamSheets.lastError=e instanceof AppError?e.message:"同步未完成，請稍後重試";s.teamSheets.lastErrorAt=nowISO();}});throw e;}})();
 try{await job.running;}finally{job.running=undefined;}
}
export function scheduleTeamSheetPush(){if(job.timer)clearTimeout(job.timer);job.timer=setTimeout(()=>{job.timer=undefined;if(readStore().teamSheets?.enabled&&!job.running&&pendingTeamTasks())void runTeamSheetSync("push").catch(()=>{});},3000);job.timer.unref?.();}
