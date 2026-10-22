import type {CalEvent,Matter,Task,Member,Settings} from "./types";
import {addDays} from "./date";
export type CalendarEntry = CalEvent & {entryKind:"event"|"matter"|"task";recordId:string;parentTitle?:string;completed?:boolean};
export type CalendarIdentity={members:Member[];settings:Settings};
export const identityName=(name:string)=>name.normalize("NFKC").replace(/\s+/g,"").toLocaleLowerCase();
export function myCalendarIdentity({members,settings}:CalendarIdentity){
 const names=new Set([settings.name,...(settings.calendar.myNames||[])].map(identityName).filter(Boolean));
 const ids=new Set(settings.calendar.myMemberIds||[]);
 for(const m of members)if(ids.has(m.id)||!settings.calendar.myMemberIds&&names.has(identityName(m.name))){ids.add(m.id);names.add(identityName(m.name));}
 return {ids,names};
}
export function isMyCalendarTask(task:Task,identity:ReturnType<typeof myCalendarIdentity>){
 if(task.sourceMissing)return false;
 if(task.department==="个人"||task.reviewRequired===true)return true;
 if([...(task.memberIds||[]),...(task.sourceResponsibleMemberIds||[])].some(id=>identity.ids.has(id)))return true;
 const names=[...(!task.sourceResponsibleMemberIds?.length?task.sourceResponsibleNames||[]:[]),...(!task.memberIds?.length?(task.assignee||"").split(/[、,，;；\n/]+/):[])];
 if(names.some(name=>identity.names.has(identityName(name))))return true;
 // A manually created, unassigned item belongs to the owner of this personal workbench.
 return !task.sourceRefs?.length&&!task.memberIds?.length&&!task.assignee?.trim()&&!task.sourceResponsibleNames?.length&&!task.sourceResponsibleMemberIds?.length;
}
/** References to source records, never persisted as duplicate calendar events. */
export function calendarEntries(events:CalEvent[],matters:Matter[],tasks:Task[],context?:CalendarIdentity):CalendarEntry[]{
 const identity=context?myCalendarIdentity(context):undefined;
 const visibleTasks=identity?tasks.filter(t=>isMyCalendarTask(t,identity)):tasks;
 const entries:CalendarEntry[]=events.map(e=>({...e,entryKind:"event",recordId:e.id}));
 for(const m of matters){if(!m.startDate)continue;if(identity&&m.department!=="个人"&&tasks.some(t=>t.matterId===m.id)&&!visibleTasks.some(t=>t.matterId===m.id))continue;entries.push({id:`matter:${m.id}`,recordId:m.id,entryKind:"matter",title:m.title,start:m.startDate,end:addDays(m.endDate||m.startDate,1),allDay:true,tags:[m.department],description:m.note,source:"ui",createdAt:m.createdAt,updatedAt:m.updatedAt});}
 for(const t of visibleTasks){if(!t.due||t.sourceMissing)continue;const parent=matters.find(m=>m.id===t.matterId);entries.push({id:`task:${t.id}`,recordId:t.id,entryKind:"task",parentTitle:parent?.title,completed:t.status==="done",title:t.title,start:t.due,allDay:t.due.length===10,tags:[t.department],description:t.note,source:"ui",createdAt:t.createdAt,updatedAt:t.updatedAt});}
 return entries.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export const entryLabel=(e:CalendarEntry)=>e.entryKind==="matter"?"事务":e.entryKind==="task"?(e.completed?"已通过任务":e.parentTitle?"子任务":"任务"):"日程";
export function entryOnDay(e:CalEvent,day:string){
 const first=e.start.slice(0,10);if(day<first)return false;
 if(!e.end)return day===first;
 // All-day end dates are exclusive; midnight timed endings also exclude that day.
 const last=e.end.slice(0,10);return e.allDay||/T00:00(?::00)?$/.test(e.end)?day<last:day<=last;
}
