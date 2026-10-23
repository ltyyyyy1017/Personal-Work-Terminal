import type {Task,Member} from "./types";

const fields=["title","matterId","memberIds","assignee","workDate","due","status","note","sourceHours"] as const;
export type SourceTaskFields=Partial<Pick<Task,typeof fields[number]>>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Merge independent document edits without treating a local note or approval as
 * an edit to every field. A conflict keeps its old baseline until reconciled. */
export function mergeSourceTask(current:Task,incoming:Task,canReplaceLegacy:boolean){
 const before=JSON.stringify(current),conflicts:string[]=[];
 const baseline=current.sourceBaseline,first=!baseline;
 const nextBaseline:SourceTaskFields={...baseline};
 for(const key of fields){
  const local=current[key],remote=incoming[key],base=baseline?.[key];
  if(first&&!canReplaceLegacy&&!same(local,remote)){
   // Existing installations may already contain intentional local changes.
   // Preserve those fields while enabling future updates to independent fields.
   conflicts.push(key);Object.assign(nextBaseline,{[key]:remote});continue;
  }
  if(first||same(local,base)||same(local,remote))Object.assign(current,{[key]:remote});
  else if(!same(remote,base)){conflicts.push(key);continue;}
  Object.assign(nextBaseline,{[key]:remote});
 }
 current.sourceBaseline=nextBaseline;
 current.sourceRecorded=incoming.sourceRecorded;
 current.sourceMissing=false;
 if(before!==JSON.stringify(current))current.updatedAt=incoming.updatedAt;
 return conflicts;
}

export const SOURCE_POLL_MS=5*60_000;
export const SOURCE_RETRY_MS=2*60_000;
export function sourceConflictLabels(keys:string[]){const labels:Record<string,string>={title:"工作名稱",matterId:"所屬事項",memberIds:"執行成員",assignee:"執行人",workDate:"工作日期",due:"截止日期",status:"進度",note:"備註",sourceHours:"來源參考時長"};return keys.map(k=>labels[k]||k).join("、");}

export function scopeSourceParticipants(task:Task,members:Member[]){
 const allowed=new Map(members.filter(m=>m.department===task.department).map(m=>[m.id,m]));
 task.memberIds=(task.memberIds||[]).filter(id=>allowed.has(id));
 task.assignee=task.memberIds.map(id=>allowed.get(id)!.name).join("、");
 if(task.sourceResponsibleMemberIds){task.sourceResponsibleMemberIds=task.sourceResponsibleMemberIds.filter(id=>allowed.has(id));task.sourceResponsibleNames=task.sourceResponsibleMemberIds.map(id=>allowed.get(id)!.name);}
}
