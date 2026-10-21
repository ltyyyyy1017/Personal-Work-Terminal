import type {Task} from "./types";
export function taskVolunteerDate(task:Pick<Task,"approvedAt"|"updatedAt">){const stamp=task.approvedAt||task.updatedAt;const date=new Date(stamp);return Number.isNaN(date.getTime())?stamp.slice(0,10):new Date(date.getTime()+8*3600_000).toISOString().slice(0,10);}

export function requiresMyReview(task:Task){
 return task.status==="review"||(task.reviewRequired??Boolean(task.memberIds?.length||task.assignee?.trim()));
}
export function followupReason(task:Task,today:string):string|undefined{
 if(task.status==="done")return;
 if(task.status==="review")return "审批中 · 待你确认";
 if(task.due&&task.due.slice(0,10)<today)return "已逾期，需跟进";
 if(task.due?.slice(0,10)===today)return "今天截止";
 if(task.followUp&&task.followUp.slice(0,10)<=today)return "需要跟进";
 if(requiresMyReview(task))return task.memberIds?.length||task.assignee?.trim()?"待审批 · 由你负责":"待指定执行成员 · 由你审批";
}
export function followupTasks(tasks:Task[],today:string){
 const rank=(t:Task)=>t.status==="review"?0:t.due&&t.due.slice(0,10)<today?1:t.due?.slice(0,10)===today?2:3;
 return tasks.filter(t=>followupReason(t,today)).sort((a,b)=>rank(a)-rank(b)||(a.followUp||a.due||"9999").localeCompare(b.followUp||b.due||"9999")||a.createdAt.localeCompare(b.createdAt));
}
