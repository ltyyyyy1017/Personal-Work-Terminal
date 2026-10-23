import type {Task,WorkLog,SyncedVolunteer,Member} from "./types";
import {isVolunteerLeader} from "./task-reporting";
import {taskVolunteerDate} from "./task-followup";

export interface WorkRecordRow {
 role?:"執行"|"審核"|"執行及審核";
 recordOnly?:boolean;
 id:string;memberId:string;title:string;date:string;taskId?:string;workLogId?:string;
 confirmedHours?:number;sourceHours?:number;sourceWorkHours?:number;
 entered?:boolean;sourceEntered?:boolean;origin:"task"|"worklog"|"sheet";
}
/** Read-only projection. Source hours are never converted to recognized hours. */
export function workRecordRows(tasks:Task[],logs:WorkLog[],sources:SyncedVolunteer[],members:Member[],month="",ownerId?:string){
 const roster=new Map(members.filter(m=>m.department==="运营部").map(m=>[m.id,m]));
 const eligible=tasks.filter(t=>t.department==="运营部"&&t.status==="done"&&!t.sourceMissing&&t.reportToTeamSheets!==false);
 const rows:WorkRecordRow[]=[],covered=new Set<string>();
 const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:undefined;
 const recognized=(t:Task,id:string)=>!isVolunteerLeader(roster.get(id))&&(!t.sourceRefs?.some(r=>r.startsWith("td:"))||t.reportToTeamSheets===true)?number(t.volunteerHours?.[id]):undefined;
 for(const source of sources){
  const id=source.memberId;if(!id||!roster.has(id))continue;
  const linked=tasks.find(t=>t.id===source.localTaskId||t.sourceRefs?.some(ref=>source.sourceRefs.includes(ref)));
  if(linked&&(linked.sourceMissing||linked.reportToTeamSheets===false||linked.status!=="done"))continue;
  const leader=isVolunteerLeader(roster.get(id)),confirmed=linked?recognized(linked,id):undefined;
  rows.push({id:`sheet:${source.id}:${id}`,memberId:id,title:linked?.title||source.detail||source.title,date:linked?.workDate||source.date,taskId:linked?.id,
   confirmedHours:confirmed,sourceHours:leader?undefined:number(source.hours),sourceWorkHours:leader?undefined:number(source.workHours),
   entered:confirmed!==undefined?linked!.volunteerEntered===true:source.entered,sourceEntered:source.entered,origin:"sheet"});
  if(linked)covered.add(`${linked.id}:${id}`);
 }
 for(const task of eligible)for(const id of task.memberIds||[]){
  if(!roster.has(id)||covered.has(`${task.id}:${id}`))continue;
  rows.push({id:`task:${task.id}:${id}`,memberId:id,title:task.title,date:taskVolunteerDate(task),taskId:task.id,
   confirmedHours:recognized(task,id),sourceHours:isVolunteerLeader(roster.get(id))?undefined:number(task.sourceHours?.[id]),
   entered:recognized(task,id)!==undefined?task.volunteerEntered===true:task.sourceRecorded?undefined:task.volunteerEntered===true,origin:task.sourceRecorded?"sheet":"task"});
 }
 for(const log of logs.filter(w=>w.status==="done"))for(const id of log.memberIds){
  if(!roster.has(id)||tasks.some(t=>t.id===log.taskId&&t.reportToTeamSheets===false))continue;
  const row=rows.find(r=>r.memberId===id&&r.taskId&&r.taskId===log.taskId);
  const confirmed=!isVolunteerLeader(roster.get(id))&&log.volunteerConfirmed?number(log.volunteerHours?.[id]):undefined;
  if(row){row.workLogId=log.id;row.date=log.date;if(row.confirmedHours===undefined&&confirmed!==undefined){row.confirmedHours=confirmed;row.entered=log.volunteerEntered===true;}continue;}
  rows.push({id:`worklog:${log.id}:${id}`,memberId:id,title:log.title,date:log.date,taskId:log.taskId,workLogId:log.id,confirmedHours:confirmed,entered:log.volunteerEntered===true,origin:"worklog"});
 }
 for(const task of tasks.filter(t=>t.department==="运营部"&&t.status==="done"&&!t.sourceMissing)){
  const ids=[...new Set([...(task.reviewerMemberIds||[]),...(ownerId&&task.memberIds?.includes(ownerId)?[ownerId]:[])])];
  for(const id of ids)if(roster.has(id)&&!rows.some(r=>r.taskId===task.id&&r.memberId===id))rows.push({id:`owner:${task.id}:${id}`,memberId:id,title:task.title,date:taskVolunteerDate(task),taskId:task.id,entered:undefined,origin:task.sourceRecorded?"sheet":"task"});
 }
 for(const row of rows){
  const task=tasks.find(t=>t.id===row.taskId),reviews=task?.reviewerMemberIds?.includes(row.memberId),executes=task?.memberIds?.includes(row.memberId);
  row.role=reviews?executes?"執行及審核":"審核":"執行";
  row.recordOnly=isVolunteerLeader(roster.get(row.memberId))||row.memberId===ownerId||Boolean(reviews&&!executes);
  if(row.recordOnly){row.confirmedHours=undefined;row.sourceHours=undefined;row.sourceWorkHours=undefined;row.entered=undefined;}
 }
 return rows.filter(r=>!month||r.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title)||a.memberId.localeCompare(b.memberId));
}
