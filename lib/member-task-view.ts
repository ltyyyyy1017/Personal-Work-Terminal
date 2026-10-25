import type {Task,Member} from "./types";
export function memberTaskRows(tasks:Task[],members:Member[],department:string,memberId:string){
 const member=members.find(m=>m.id===memberId&&m.department===department);if(!member)return [];
 return tasks.filter(t=>t.department===department&&!t.sourceMissing).flatMap(task=>{
  const execution=task.memberIds?.includes(memberId)||!task.memberIds?.length&&(task.assignee||"").split(/[、,，;；\n/]+/).some(n=>n.trim()===member.name)&&members.filter(m=>m.department===department&&m.name===member.name).length===1;
  const responsible=task.sourceResponsibleMemberIds?.includes(memberId),review=task.reviewerMemberIds?.includes(memberId);
  const roles=[execution?"执行":"",responsible?"负责":"",review?"审核":""].filter(Boolean);
  return roles.length?[{task,roles}]:[];
 }).sort((a,b)=>Number(a.task.status==="done")-Number(b.task.status==="done")||Number(b.task.status==="review")-Number(a.task.status==="review")||(a.task.due||"9999").localeCompare(b.task.due||"9999")||a.task.title.localeCompare(b.task.title));
}
