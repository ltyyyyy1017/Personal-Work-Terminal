import type {CalEvent,Matter,Task} from "./types";
import {addDays} from "./date";
export type CalendarEntry = CalEvent & {entryKind:"event"|"matter"|"task";recordId:string;parentTitle?:string;completed?:boolean};
/** References to source records, never persisted as duplicate calendar events. */
export function calendarEntries(events:CalEvent[],matters:Matter[],tasks:Task[]):CalendarEntry[]{
 const entries:CalendarEntry[]=events.map(e=>({...e,entryKind:"event",recordId:e.id}));
 for(const m of matters){if(!m.startDate)continue;entries.push({id:`matter:${m.id}`,recordId:m.id,entryKind:"matter",title:m.title,start:m.startDate,end:addDays(m.endDate||m.startDate,1),allDay:true,tags:[m.department],description:m.note,source:"ui",createdAt:m.createdAt,updatedAt:m.updatedAt});}
 for(const t of tasks){if(!t.due||t.sourceMissing)continue;const parent=matters.find(m=>m.id===t.matterId);entries.push({id:`task:${t.id}`,recordId:t.id,entryKind:"task",parentTitle:parent?.title,completed:t.status==="done",title:t.title,start:t.due,allDay:t.due.length===10,tags:[t.department],description:t.note,source:"ui",createdAt:t.createdAt,updatedAt:t.updatedAt});}
 return entries.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export const entryLabel=(e:CalendarEntry)=>e.entryKind==="matter"?"事务":e.entryKind==="task"?(e.completed?"已通过任务":e.parentTitle?"子任务":"任务"):"日程";
export function entryOnDay(e:CalEvent,day:string){
 const first=e.start.slice(0,10);if(day<first)return false;
 if(!e.end)return day===first;
 // All-day end dates are exclusive; midnight timed endings also exclude that day.
 const last=e.end.slice(0,10);return e.allDay||/T00:00(?::00)?$/.test(e.end)?day<last:day<=last;
}
