import type {Task,WorkLog,SyncedVolunteer,Member} from "./types";
import {isVolunteerLeader} from "./task-reporting";
import {taskVolunteerDate} from "./task-followup";

export interface VolunteerEntry {
 id:string;memberId:string;title:string;date:string;hours:number;entered:boolean;
 sources:{kind:"task"|"worklog"|"sheet";id:string}[];
}
export interface VolunteerConflict {memberId:string;title:string;date:string;hours:number[];sources:VolunteerEntry["sources"]}
type Candidate=VolunteerEntry&{refs:string[];taskId?:string};
const text=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase();
/** One ledger powers displayed totals and exports. Never add two representations
 * of the same person's work. Conflicting values stay visible for review. */
export function volunteerLedger(tasks:Task[],records:WorkLog[],month="",imported:SyncedVolunteer[]=[],members:Member[]=[],includeImported=false){
 const excluded=(id:string)=>isVolunteerLeader(members.find(m=>m.id===id));
 const personal=(id:string|undefined)=>Boolean(id&&tasks.some(t=>t.id===id&&t.reportToTeamSheets===false));
 const candidates:Candidate[]=[];
 for(const t of tasks)if(t.department==="运营部"&&t.status==="done"&&t.reportToTeamSheets!==false&&!t.sourceMissing&&(!t.sourceRefs?.some(r=>r.startsWith("td:"))||t.reportToTeamSheets===true)){
  const date=taskVolunteerDate(t);
  for(const id of t.memberIds||[])if(!excluded(id)&&Number.isFinite(t.volunteerHours?.[id]))candidates.push({id:`task:${t.id}:${id}`,memberId:id,title:t.title,date,hours:t.volunteerHours![id],entered:t.volunteerEntered===true,sources:[{kind:"task",id:t.id}],refs:t.sourceRefs||[],taskId:t.id});
 }
 for(const w of records)if(w.status==="done"&&w.volunteerConfirmed&&!personal(w.taskId))for(const id of w.memberIds)if(!excluded(id)&&Number.isFinite(w.volunteerHours?.[id]))candidates.push({id:`worklog:${w.id}:${id}`,memberId:id,title:w.title,date:w.date,hours:w.volunteerHours![id],entered:w.volunteerEntered===true,sources:[{kind:"worklog",id:w.id}],refs:w.sourceRefs||[],taskId:w.taskId});
 for(const r of includeImported?imported:[])if(r.memberId&&!excluded(r.memberId)&&!personal(r.localTaskId)&&r.hours!==null&&Number.isFinite(r.hours)){if(r.localTaskId){const task=tasks.find(t=>t.id===r.localTaskId);if(!task||r.localVersion!==task.updatedAt)continue;}candidates.push({id:r.id,memberId:r.memberId,title:r.title,date:r.date,hours:r.hours,entered:r.entered,sources:[{kind:"sheet",id:r.id}],refs:r.sourceRefs,taskId:r.localTaskId});}
 // Union only explicit links or a single exact task/work-log pair. Repeated
 // tasks with the same title and date remain separate unless explicitly linked.
 const parent=candidates.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const join=(a:number,b:number)=>{parent[find(b)]=find(a);};
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
  const a=candidates[i],b=candidates[j];if(a.memberId!==b.memberId)continue;
  if(a.taskId&&a.taskId===b.taskId||a.refs.some(ref=>b.refs.includes(ref)))join(i,j);
 }
 const byMeaning=new Map<string,number[]>();candidates.forEach((c,i)=>{if(c.sources[0].kind==="worklog"&&c.taskId)return;const key=JSON.stringify([c.memberId,c.date,text(c.title)]);byMeaning.set(key,[...(byMeaning.get(key)||[]),i]);});
 for(const indices of byMeaning.values())if(indices.length===2&&candidates[indices[0]].sources[0].kind!==candidates[indices[1]].sources[0].kind)join(indices[0],indices[1]);
 const groups=new Map<number,Candidate[]>();candidates.forEach((c,i)=>groups.set(find(i),[...(groups.get(find(i))||[]),c]));
 const entries:VolunteerEntry[]=[],conflicts:VolunteerConflict[]=[];let duplicates=0;
 for(const group of groups.values()){
  // A linked work log supplies the actual work date, rather than approval date.
  const chosen=group.find(c=>c.sources[0].kind==="worklog")||group.find(c=>c.sources[0].kind==="sheet")||group[0];if(month&&!chosen.date.startsWith(month))continue;
  const hours=[...new Set(group.map(c=>Math.round(c.hours*100)/100))],sources=group.flatMap(c=>c.sources);
  if(hours.length>1){conflicts.push({memberId:chosen.memberId,title:chosen.title,date:chosen.date,hours,sources});continue;}
  duplicates+=group.length-1;entries.push({...chosen,hours:hours[0],sources,entered:group.some(c=>c.entered)});
 }
 return {entries:entries.sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title)),conflicts,duplicates,total:Math.round(entries.reduce((s,e)=>s+e.hours,0)*100)/100};
}
