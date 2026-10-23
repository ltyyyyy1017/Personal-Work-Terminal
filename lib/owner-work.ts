import type {Task,Store,Member} from "./types";
import {myCalendarIdentity} from "./calendar-entries";
const normalized=(s:string)=>s.normalize("NFKC").replace(/\s+/g,"").toLocaleLowerCase();

export function publicityOwner(s:Pick<Store,"members"|"settings">):Member|undefined{
 const identity=myCalendarIdentity(s),people=s.members.filter(m=>m.department==="运营部"&&identity.ids.has(m.id));
 return people.length===1?people[0]:undefined;
}
export function ownerWorkRole(task:Task,ownerId:string){
 if(task.department!=="运营部"||task.status!=="done"||task.sourceMissing)return;
 const executes=task.memberIds?.includes(ownerId),reviews=task.reviewerMemberIds?.includes(ownerId);
 return executes&&reviews?"執行及審核":reviews?"審核":executes?"執行":undefined;
}
const cleanTitle=(s:string)=>normalized(s.replace(/^(?:(?:20\d{2})[.\-/年])?\d{1,2}[.\-/月]\d{1,2}[日号號.、\s]*/,"").replace(/[；;]+$/, ""));
export function ownerWorkPlan(s:Store){
 const owner=publicityOwner(s),jobs:Task[]=[],unrouted:Task[]=[],sourceIds:Record<string,string[]>={};if(!owner||!s.teamSheets?.recordOwnerWork)return{owner,jobs,unrouted,sourceIds};
 const full=s.tasks.filter(t=>t.reportToTeamSheets===true&&t.sheetDestination&&!t.sourceMissing);
 const candidates=s.tasks.filter(t=>ownerWorkRole(t,owner.id)&&!full.some(p=>p.id===t.id&&p.memberIds?.includes(owner.id))).sort((a,b)=>Number(!a.sheetOrigin?.task)-Number(!b.sheetOrigin?.task)||a.id.localeCompare(b.id));
 const groups:Task[][]=[];
 for(const task of candidates){
  const counterpart=groups.find(g=>g.length===1&&Boolean(g[0].sheetOrigin?.task)!==Boolean(task.sheetOrigin?.task)&&Boolean(g[0].sheetOrigin?.hours)!==Boolean(task.sheetOrigin?.hours)&&cleanTitle(g[0].title)===cleanTitle(task.title)&&(g[0].workDate||"")===(task.workDate||""));
  if(counterpart)counterpart.push(task);else groups.push([task]);
 }
 for(const group of groups){
  const task=group[0],dest=task.sheetDestination||s.teamSheets.ownerDestinations?.[task.matterId||""];
  if(!dest){unrouted.push(...group);continue;}
  const prior:[string,string[]][]=Object.entries(s.teamSheets.ownerPublicationSources||{}).filter(([,ids])=>group.some(t=>ids.includes(t.id)));
  // Ambiguous previously independent publications are not silently merged.
  if(prior.length>1){unrouted.push(...group);continue;}
  const id=prior[0]?.[0]||`owner:${owner.id}:${task.id}`,role=ownerWorkRole(task,owner.id);
  const originalTask=group.find(t=>t.memberIds?.includes(owner.id)&&t.sheetOrigin?.task)?.sheetOrigin?.task,originalHours=group.find(t=>t.memberIds?.includes(owner.id)&&t.sheetOrigin?.hours)?.sheetOrigin?.hours;
  sourceIds[id]=group.map(t=>t.id);
  jobs.push({...task,id,title:role==="審核"?`${task.title}（審核）`:task.title,assignee:owner.name,memberIds:[owner.id],reviewerMemberIds:[],reportToTeamSheets:true,sheetDestination:dest,sheetOrigin:{task:originalTask,hours:originalHours},volunteerHours:undefined,volunteerEntered:false,note:role==="審核"?`工作角色：審核\n${task.note||""}`:task.note});
 }
 return{owner,jobs,unrouted,sourceIds};
}
