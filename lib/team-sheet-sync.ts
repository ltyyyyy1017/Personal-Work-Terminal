import fs from "node:fs";
import path from "node:path";
import {readStore,mutateStore,newId,nowISO,dirs,appendLog} from "./store";
import {atomicWrite} from "./atomic-file";
import {assert,AppError} from "./errors";
import {tencentClient,tencentConnected,type SheetCell,type SheetInfo} from "./tencent-docs";
import {parseAssignments,parseVolunteer,digest,sheetRows,cellValue,normalized,taskSyncPayload,type SheetSnapshot} from "./team-sheet-data";
import type {TeamSheetState,Task,Store,SyncedVolunteer} from "./types";

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
 const current=readStore(),assignments=parseAssignments(taskSnapshots,config.taskFileId,config.department,current.members,config.academicYear,config.taskSheetId),volunteers=parseVolunteer(hourSnapshots,config.hoursFileId,config.department,current.members,config.academicYear,assignments,config.hoursSheetId);
 await mutateStore(s=>{
  assert(s.teamSheets?.taskFileId===config.taskFileId&&s.teamSheets.hoursFileId===config.hoursFileId,"同步設定已改動，請重試",409);
  const stamp=nowISO(),seen=new Set(assignments.map(a=>a.key)),conflicts:string[]=[];let added=0;
  s.teamSheets.importHashes??={};
  for(const a of assignments){
   let matter=s.matters.find(m=>m.department===config.department&&normalized(m.title)===normalized(a.matter));if(!matter){matter={id:newId("matter"),title:a.matter,department:config.department,note:"從團學任務分工表匯入",createdAt:stamp,updatedAt:stamp};s.matters.push(matter);}
   const existing=s.tasks.find(t=>t.sourceRefs?.includes(a.key));
   if(existing?.sourceMissing){existing.sourceMissing=false;existing.updatedAt=stamp;}
   const item:Task={id:existing?.id||`td_task_${digest(a.key)}`,title:a.title,department:config.department,matterId:matter.id,memberIds:a.memberIds,assignee:a.names.join("、"),due:a.date||undefined,workDate:a.date,status:a.done?"done":"doing",reviewRequired:!a.done,priority:"normal",note:`來源：團學任務分工 · ${a.matter}\n${a.phase?`時間／階段：${a.phase}\n`:""}執行人：${a.names.join("、")}\n來源記錄由線上表格同步；志願時以匯總表為準。`,sourceRefs:[a.key,...a.refs],sourceMissing:false,createdAt:existing?.createdAt||stamp,updatedAt:existing?.updatedAt||stamp};
   const content=(t:Task)=>{const {updatedAt,createdAt,organization,sourceMissing,...rest}=t;return digest(rest);},legacy=(t:Task)=>{const {updatedAt,createdAt,...rest}=t;return digest(rest);},nextHash=content(item),last=s.teamSheets.importHashes[item.id],canUpdate=!existing||!last||[content(existing),legacy(existing),legacy({...existing,organization:undefined})].includes(last.local);
   if(existing){const currentHash=content(existing);if(!canUpdate){if(![nextHash,legacy(item)].includes(last.source))conflicts.push(`${a.matter} · ${a.title}：本機及來源均有修改，已保留本機版本，請核對。`);}else if(currentHash!==nextHash)Object.assign(existing,item,{updatedAt:stamp});}
   else{s.tasks.push(item);added++;}
   if(canUpdate)s.teamSheets.importHashes[item.id]={local:content(existing||item),source:nextHash};
  }
  for(const t of s.tasks)if(t.sourceRefs?.some(r=>r.startsWith("td:assignment:"))&&!t.sourceRefs.some(r=>seen.has(r)))t.sourceMissing=true;
  s.teamSheets.volunteers=volunteers.records;s.teamSheets.issues=[...volunteers.issues,...conflicts];s.teamSheets.importedCount=assignments.length;s.teamSheets.lastPullAt=stamp;s.teamSheets.lastError=undefined;s.teamSheets.lastErrorAt=undefined;
  if(added)appendLog(s,"sync",`團學分工匯入 ${added} 項，志願時按來源編號更新，沒有累加重複記錄`);
 });
}
async function managedSheet(client:Client,config:TeamSheetState,kind:"task"|"hours"){
 const field=kind==="task"?"taskSheetId":"hoursSheetId",file=kind==="task"?config.taskFileId:config.hoursFileId,header=kind==="task"?taskHeader:hoursHeader,info=await client.info(file);let sheet=info.sheets.find(s=>s.sheet_id===readStore().teamSheets?.[field]);
 const base=`工作台同步·${config.department}`.slice(0,27);
 if(!sheet){
  // Recover an already-created integration tab only when all header cells match.
  for(const candidate of info.sheets.filter(s=>s.sheet_name.startsWith(base))){const d=await client.read(file,candidate.sheet_id,0,12);const row=sheetRows(d.cells).get(0);if(row&&header.every((h,i)=>row.get(i)===h)){sheet=candidate;break;}}
  if(!sheet){let name=base,index=2;while(info.sheets.some(s=>s.sheet_name===name))name=`${base}-${index++}`;const added=await client.add(file,name);sheet=(await client.info(file)).sheets.find(s=>s.sheet_id===added.sheet_id);assert(sheet,"新分表尚未可讀，請稍後重新同步",502);}
  const selected=sheet;await mutateStore(s=>{assert(s.teamSheets,"請先設定同步");s.teamSheets[field]=selected.sheet_id;});config[field]=sheet.sheet_id;
 }
 const d=await client.read(file,sheet.sheet_id,0,12),row=sheetRows(d.cells).get(0);
 if(!row||[...row.values()].every(v=>v==="")){await client.write(file,sheet.sheet_id,header.map((v,i)=>valueCell(0,i,v)));}
 else assert(header.every((h,i)=>row.get(i)===h),"工作台同步分表的欄位已被改動，已停止寫入以保護資料",409);
 return {file,sheet,header};
}
export function eligibleTasks(s:Store){const c=s.teamSheets;return !c?[]:s.tasks.filter(t=>t.department===c.department&&!t.demo&&!t.sourceRefs?.some(r=>r.startsWith("td:"))&&t.createdAt>=c.enabledAt);}
function taskHash(s:Store,t:Task){return digest(taskSyncPayload(t,s.members,s.matters.find(m=>m.id===t.matterId)?.title||t.activityName||"未分類事項"));}
export function pendingTeamTasks(s=readStore()){const c=s.teamSheets;if(!c?.enabled)return 0;const tasks=eligibleTasks(s);return tasks.filter(t=>c.taskHashes[t.id]!==taskHash(s,t)).length+Object.keys(c.taskHashes).filter(id=>!tasks.some(t=>t.id===id)).length;}
export async function pushTeamSheets(client:Client,config:TeamSheetState){
 const before=readStore(),tasks=eligibleTasks(before),changed=tasks.filter(t=>config.taskHashes[t.id]!==taskHash(before,t)),removed=Object.keys(config.taskHashes).filter(id=>!tasks.some(t=>t.id===id));
 // Track a first publication before sending it. If the second document fails
 // and the task is then deleted, its partially published rows still get cleared.
 if(changed.length)await mutateStore(s=>{assert(s.teamSheets?.enabled&&s.teamSheets.taskFileId===config.taskFileId&&s.teamSheets.hoursFileId===config.hoursFileId,"同步設定已改動",409);for(const t of changed)s.teamSheets.taskHashes[t.id]??="";});
 const taskTarget=await managedSheet(client,config,"task"),hoursTarget=await managedSheet(client,config,"hours");if(!changed.length&&!removed.length)return;const affected=new Set([...changed.map(t=>t.id),...removed]);
 const writes:{file:string;sheet:SheetInfo;values:SheetCell[];expected:Map<string,(string|number)[]>;keyCol:number}[]=[];
 for(const [kind,target]of [["task",taskTarget],["hours",hoursTarget]]as const){
  const snapshot=await readSheet(client,target.file,target.sheet),rows=sheetRows(snapshot.cells),keyCol=kind==="task"?7:9,existing=new Map<string,{row:number;values:(string|number)[]}>();let nextRow=1;
  for(const [row,cells]of rows){if(row===0)continue;if([...cells.values()].some(v=>v!==""))nextRow=Math.max(nextRow,row+1);const key=String(cells.get(keyCol)||"");if(!key.startsWith("wb:"))continue;assert(!existing.has(key),"同步分表中出現重複工作台編號，請先核對",409);existing.set(key,{row,values:Array.from({length:13},(_,i)=>cells.get(i) as string|number??"")});}
  const desired=new Map<string,(string|number)[]>();
  for(const t of changed)for(const p of taskSyncPayload(t,before.members,before.matters.find(m=>m.id===t.matterId)?.title||t.activityName||"未分類事項")){
   const status=p.status==="done"?"已通過":p.status==="review"?"審批中":"待審批";
   const values:(string|number)[]=kind==="task"?["",p.date,p.title,p.name,"",status,p.matter,p.key,p.taskId,p.memberId,p.entered?"已錄入":"未錄入"]:["",p.name,p.title,"","",p.hours??"",p.entered?"已錄入":"未錄入",p.date,p.taskId,p.key,p.matter];
   values.push(digest(values),p.updatedAt);desired.set(p.key,values);
  }
  const values:SheetCell[]=[],expected=new Map<string,(string|number)[]>();
  for(const [key,old]of existing){const taskId=String(old.values[8]||"");if(!affected.has(taskId))continue;
   const agreed=desired.get(key);const sameValues=agreed&&JSON.stringify(old.values.slice(0,11))===JSON.stringify(agreed.slice(0,11));
   if(snapshot.cells.some(c=>c.row===old.row&&c.formula)||digest(old.values.slice(0,11))!==old.values[11]&&!sameValues)throw new AppError("同步分表有人工改動，已保留原值並停止覆寫；請核對後把工作台資料改為相同內容，再重新同步",409);
   if(!desired.has(key)){for(let i=0;i<13;i++)values.push(valueCell(old.row,i,""));expected.set(key,[]);}
  }
  for(const [key,want]of desired){const old=existing.get(key);if(old&&JSON.stringify(old.values)===JSON.stringify(want))continue;const row=old?.row??nextRow++;assert(row<target.sheet.row_count,"同步分表的空間不足，請增加行數後重試");for(let i=0;i<13;i++)values.push(valueCell(row,i,want[i]));expected.set(key,want);}
  writes.push({file:target.file,sheet:target.sheet,values,expected,keyCol});
 }
 let verifiedHours:SyncedVolunteer[]|undefined;
 for(const target of writes){if(!target.values.length)continue;const current=readStore().teamSheets;assert(current?.enabled&&current.taskFileId===config.taskFileId&&current.hoursFileId===config.hoursFileId,"同步設定已改動，已停止寫入",409);for(let offset=0;offset<target.values.length;offset+=390)await client.write(target.file,target.sheet.sheet_id,target.values.slice(offset,offset+390));
  const verified=await readSheet(client,target.file,target.sheet),after=sheetRows(verified.cells),keys=new Map<string,(string|number)[]>();for(const cells of after.values()){const key=String(cells.get(target.keyCol)||"");if(key){assert(!keys.has(key),"核對時發現重複同步編號，請檢查分表",409);keys.set(key,Array.from({length:13},(_,i)=>cells.get(i) as string|number??""));}}
  for(const [key,want]of target.expected)assert(want.length?JSON.stringify(keys.get(key))===JSON.stringify(want):!keys.has(key),"寫入後核對未通過，已保留待同步狀態；重試會按編號更新，不會重複新增",502);
  if(target.keyCol===9)verifiedHours=parseVolunteer([verified],config.hoursFileId,config.department,before.members,config.academicYear,[],target.sheet.sheet_id).records;
 }
 await mutateStore(s=>{assert(s.teamSheets,"同步設定不存在");for(const t of changed)s.teamSheets.taskHashes[t.id]=taskHash(before,t);for(const id of removed)delete s.teamSheets.taskHashes[id];if(verifiedHours)s.teamSheets.volunteers=[...s.teamSheets.volunteers.filter(r=>!r.localTaskId),...verifiedHours];s.teamSheets.lastPushAt=nowISO();s.teamSheets.lastError=undefined;s.teamSheets.lastErrorAt=undefined;});
}
export async function runTeamSheetSync(mode:"all"|"pull"|"push"="all"){
 while(job.running)try{await job.running;}catch{/* A later request can retry a failed run. */}
 const config=readStore().teamSheets;assert(config?.enabled,"請先設定並啟用團學表格同步");assert(tencentConnected(),"請先授權騰訊文檔");
 job.running=(async()=>{try{const client=await tencentClient();let pushError:unknown;if(mode!=="pull")try{await pushTeamSheets(client,config);}catch(e){if(mode==="push")throw e;pushError=e;}if(mode!=="push")await pullTeamSheets(client,readStore().teamSheets!);if(pushError)throw pushError;}catch(e){await mutateStore(s=>{if(s.teamSheets){s.teamSheets.lastError=e instanceof AppError?e.message:"同步未完成，請稍後重試";s.teamSheets.lastErrorAt=nowISO();}});throw e;}})();
 try{await job.running;}finally{job.running=undefined;}
}
export function scheduleTeamSheetPush(){if(job.timer)clearTimeout(job.timer);job.timer=setTimeout(()=>{job.timer=undefined;if(readStore().teamSheets?.enabled&&!job.running&&pendingTeamTasks())void runTeamSheetSync("push").catch(()=>{});},3000);job.timer.unref?.();}
