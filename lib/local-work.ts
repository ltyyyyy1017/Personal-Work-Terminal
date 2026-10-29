import type {Store,Task,LocalWorkRecord} from "./types";
const number=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:undefined;
const norm=(v:string)=>v.normalize("NFKC").replace(/\s+/g,"").replace(/[；;]+$/,"");
/** One-time, offline projection. Unknown dates/hours stay blank; no remote calls. */
export function migrateLocalWork(s:Store){
 s.localWorkRecords??=[];if(s.meta.localWorkVersion===1){delete s.teamSheets;delete s.kdocs;return;}
 const covered=new Set<string>(),stamp=new Date().toISOString();
 const add=(r:LocalWorkRecord)=>{if(!s.localWorkRecords.some(x=>x.id===r.id))s.localWorkRecords.push(r);if(r.taskId)covered.add(`${r.taskId}:${r.memberId}`);};
 for(const w of s.workLogs.filter(w=>w.status==="done"))for(const id of w.memberIds){const member=s.members.find(m=>m.id===id);if(!member)continue;const minutes=(v:string)=>/^\d{2}:\d{2}$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):NaN;add({id:`legacy:work:${w.id}:${id}`,department:member.department,memberId:id,taskId:w.taskId,title:w.title,date:w.date,hours:number((minutes(w.end)-minutes(w.start))/60),volunteerHours:number(w.volunteerHours?.[id]),role:"執行",tableRecorded:false,note:w.note||"",createdAt:w.createdAt,updatedAt:w.updatedAt});}
 for(const v of s.teamSheets?.volunteers||[]){if(!v.memberId||!s.members.some(m=>m.id===v.memberId))continue;const task=s.tasks.find(t=>t.id===v.localTaskId||t.sourceRefs?.some(r=>v.sourceRefs.includes(r)));if(task?.sourceMissing||task&&covered.has(`${task.id}:${v.memberId}`))continue;add({id:`legacy:hours:${v.id}`,department:"运营部",memberId:v.memberId,taskId:task?.id,title:task?.title||v.detail||v.title,date:task?.workDate||v.date||"",hours:number(v.workHours),volunteerHours:number(v.hours),role:"執行",tableRecorded:true,note:v.detail,createdAt:task?.createdAt||stamp,updatedAt:stamp});}
 for(const t of s.tasks.filter(t=>t.status==="done"&&!t.sourceMissing))for(const id of [...new Set([...(t.memberIds||[]),...(t.reviewerMemberIds||[])])]){
  if(covered.has(`${t.id}:${id}`)||!s.members.some(m=>m.id===id&&m.department===t.department))continue;
  const executes=t.memberIds?.includes(id),reviews=t.reviewerMemberIds?.includes(id),date=t.workDate||"";
  const mirrors=t.sheetOrigin?.task?s.localWorkRecords.filter(r=>r.id.startsWith("legacy:hours:")&&r.memberId===id&&r.date===date&&norm(r.title)===norm(t.title)):[];
  if(mirrors.length===1){mirrors[0].relatedTaskIds=[...new Set([...(mirrors[0].relatedTaskIds||[]),t.id])];continue;}
  const recorded=Boolean(t.sourceRecorded||s.teamSheets?.nativeLinks?.[t.id]?.some(l=>l.kind==="hours")||s.kdocs?.publications?.[t.id]?.length);
  add({id:`local:task:${t.id}:${id}`,department:t.department,memberId:id,taskId:t.id,matterId:t.matterId,title:t.title,date,hours:undefined,volunteerHours:executes?number(t.volunteerHours?.[id]??t.sourceHours?.[id]):undefined,performance:t.sourceRefs?.some(r=>r.startsWith("kd:"))?s.kdocs?.sourceRecords?.find(r=>t.sourceRefs?.includes(r.key))?.score:undefined,role:reviews?executes?"執行及審核":"審核":"執行",tableRecorded:recorded,note:t.note||"",createdAt:t.createdAt,updatedAt:t.updatedAt});
 }
 for(const p of s.performance.filter(p=>!p.sourceMissing))if(s.members.some(m=>m.id===p.memberId&&m.department==="行政部")&&!s.localWorkRecords.some(r=>r.department==="行政部"&&r.memberId===p.memberId&&r.title===p.title&&r.date===p.date))add({id:`legacy:performance:${p.id}`,department:"行政部",memberId:p.memberId,title:p.title,date:p.date,role:"執行",tableRecorded:Boolean(p.sourceRef),note:p.note,createdAt:p.createdAt,updatedAt:stamp});
 s.meta.localWorkVersion=1;delete s.teamSheets;delete s.kdocs;
}
export function recordTaskWork(s:Store,t:Task,values?:unknown){
 if(t.status!=="done")return;
 const input=Array.isArray(values)?values as {memberId:string;hours?:number;performance?:number;tableRecorded?:boolean}[]:[];
 for(const id of [...new Set([...(t.memberIds||[]),...(t.reviewerMemberIds||[])])]){
  if(!s.members.some(m=>m.id===id&&m.department===t.department))continue;
  let r=s.localWorkRecords.find(r=>r.memberId===id&&(r.taskId===t.id||r.relatedTaskIds?.includes(t.id)));const v=input.find(v=>v.memberId===id),executes=t.memberIds?.includes(id),reviews=t.reviewerMemberIds?.includes(id);
  if(!r){r={id:`local:task:${t.id}:${id}`,department:t.department,memberId:id,taskId:t.id,matterId:t.matterId,title:t.title,date:t.workDate||"",role:reviews?executes?"執行及審核":"審核":"執行",tableRecorded:false,note:t.note||"",createdAt:t.createdAt,updatedAt:t.updatedAt};s.localWorkRecords.push(r);}
  if(v){r.hours=v.hours;r.performance=v.performance;r.tableRecorded=v.tableRecorded===true;}
  r.updatedAt=t.updatedAt;
 }
}
