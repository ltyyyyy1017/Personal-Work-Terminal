import crypto from "node:crypto";
import type {SheetInfo,SheetCell} from "./tencent-docs";
import type {Member,Task,SyncedVolunteer} from "./types";
export interface SheetSnapshot {sheet:SheetInfo;cells:SheetCell[]}
export interface ImportedAssignment {key:string;matter:string;title:string;date:string;phase:string;names:string[];memberIds:string[];done:boolean;refs:string[]}
export const digest=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0,24);
export const normalized=(v:string)=>v.normalize("NFKC").replace(/\s+/g,"").toLocaleLowerCase();
export function cellValue(c:SheetCell):string|number|boolean{return c.value_type==="NUMBER"?c.number_value??0:c.value_type==="BOOL"?c.bool_value??false:c.string_value||"";}
export function sheetRows(cells:SheetCell[]){const rows=new Map<number,Map<number,string|number|boolean>>();for(const c of cells){if(!rows.has(c.row))rows.set(c.row,new Map());rows.get(c.row)!.set(c.col,cellValue(c));}return rows;}
const rowText=(row:Map<number,string|number|boolean>,col:number)=>String(row.get(col)??"").trim();
export function sheetDate(value:string,year:number){
 const full=value.trim().match(/^(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})(?![\d.hH])/),short=value.trim().match(/^(\d{1,2})[.\-/月](\d{1,2})(?![\d.hH])/);
 if(!full&&!short)return "";const m=Number(full?.[2]||short?.[1]),d=Number(full?.[3]||short?.[2]),y=Number(full?.[1])||(m<7?year+1:year);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`:"";
}
/** Read explicit totals first. Sum hour tokens only from work descriptions,
 * excluding bracketed clock ranges so 12:30 never becomes volunteer hours. */
export function hoursValue(value:unknown):number|null{
 if(typeof value==="number")return Number.isFinite(value)&&value>=0&&value<=1000?Math.round(value*100)/100:null;
 const text=String(value??"").trim();if(!text)return null;
 if(/^\d+(?:\.\d+)?\s*(?:h|小时|小時|時|时)?$/i.test(text))return hoursValue(Number(text.match(/\d+(?:\.\d+)?/)![0]));
 const clean=text.replace(/[（(][^）)]*[）)]/g,"");const matches=[...clean.matchAll(/(\d+(?:\.\d+)?)\s*(?:h|小时|小時)/gi)];if(!matches.length)return null;return hoursValue(matches.reduce((s,m)=>s+Number(m[1]),0));
}
function roster(members:Member[],department:string){const groups=new Map<string,Member[]>();for(const m of members.filter(m=>m.department===department)){const key=normalized(m.name);groups.set(key,[...(groups.get(key)||[]),m]);}return(name:string)=>{const found=groups.get(normalized(name));return found?.length===1?found[0].id:undefined;};}
export function parseAssignments(snapshots:SheetSnapshot[],file:string,department:string,members:Member[],year:number,managedId?:string){
 const match=roster(members,department),groups=new Map<string,ImportedAssignment>();
 for(const {sheet,cells}of snapshots){if(sheet.sheet_id===managedId||/基准模板|基準模板/.test(sheet.sheet_name))continue;
  const rows=sheetRows(cells),hasSections=[...rows.values()].some(r=>/部[（(]|主席团|主席團/.test(rowText(r,0)));let active=!hasSections&&normalized(sheet.sheet_name).includes(normalized(department.replace(/部$/, ""))),phase="";
  const seen=new Map<string,number>();
  for(const [index,row]of [...rows].sort((a,b)=>a[0]-b[0])){
   const label=rowText(row,0);if(/部[（(]|主席团|主席團|统筹[（(]|統籌[（(]/.test(label)){active=normalized(label).includes(normalized(department));phase="";continue;}
   if(!active)continue;const title=rowText(row,2),name=rowText(row,3);if(!title||!name||/^(姓名|xxx|张[一二三四]|張[一二三四])$/.test(name)||/任务|任務/.test(title)&&name==="姓名")continue;
   const rawDate=rowText(row,1);if(rawDate)phase=rawDate;const date=sheetDate(rawDate,year),names=name.split(/[、,，\n/]+/).map(s=>s.trim()).filter(Boolean),ids=names.map(match).filter((id):id is string=>!!id);
   const identity=digest([sheet.sheet_id,normalized(title),names.map(normalized).sort(),date,rawDate]),occurrence=seen.get(identity)||0;seen.set(identity,occurrence+1);
   const ref=`td:task:${file}:${sheet.sheet_id}:${identity}:${occurrence}`,groupKey=digest([sheet.sheet_id,normalized(title),date,rawDate||phase]);
   const existing=groups.get(groupKey),done=/^(已完成|完成|通过|通過)$/.test(rowText(row,5));
   if(existing){existing.names=[...new Set([...existing.names,...names])];existing.memberIds=[...new Set([...existing.memberIds,...ids])];existing.done=existing.done&&done;existing.refs.push(ref);}
   else groups.set(groupKey,{key:`td:assignment:${file}:${groupKey}`,matter:sheet.sheet_name,title,date,phase,names,memberIds:ids,done,refs:[ref]});
  }
 }
 return [...groups.values()];
}
export function parseVolunteer(snapshots:SheetSnapshot[],file:string,department:string,members:Member[],year:number,assignments:ImportedAssignment[],managedId?:string){
 const match=roster(members,department),records:SyncedVolunteer[]=[],issues:string[]=[];
 for(const {sheet,cells}of snapshots){if(/基准模板|基準模板/.test(sheet.sheet_name))continue;const rows=sheetRows(cells),managed=sheet.sheet_id===managedId,header=rows.get(0);if(!header||rowText(header,1)!=="姓名")continue;
  const withDepartment=/部门|部門/.test(rowText(header,2));const dedicated=normalized(sheet.sheet_name).includes(normalized(department));if(!withDepartment&&!dedicated&&!managed)continue;let name="",dept="";const seen=new Map<string,number>();
  for(const [index,row]of [...rows].sort((a,b)=>a[0]-b[0])){if(index===0)continue;
   const label=rowText(row,0);if(/填写规则|填寫規則|^例[：:]|使用说明|使用說明/.test(label)){name="";dept="";continue;}
   if(rowText(row,1))name=rowText(row,1);if(withDepartment&&rowText(row,2))dept=rowText(row,2);
   if(!name||/^(xxx|姓名|张[一二三四]|張[一二三四])$/.test(name)||withDepartment&&normalized(dept)!==normalized(department))continue;
   const memberId=match(name);const title=withDepartment?sheet.sheet_name:rowText(row,2),online=row.get(3),offline=row.get(4),total=hoursValue(row.get(5)),detail=withDepartment?[rowText(row,3),rowText(row,4)].filter(Boolean).join("；"):rowText(row,2);
   if(!title&&!detail&&total===null)continue;const titleValue=title||sheet.sheet_name;
   const on=hoursValue(online),off=hoursValue(offline),workHours=on===null&&off===null?null:Math.round(((on||0)+(off||0))*100)/100,hours=total??workHours;
   if(hours===null&&!detail)continue;
   let date=sheetDate(rowText(row,7),year)||sheetDate(detail,year);if(!date){const matching=assignments.filter(a=>a.names.some(n=>normalized(n)===normalized(name))&&normalized(a.title)===normalized(titleValue)&&a.date);if(matching.length===1)date=matching[0].date;}
   const localTaskId=managed?rowText(row,8):undefined,identity=digest([sheet.sheet_id,normalized(name),normalized(titleValue),normalized(detail),managed?rowText(row,9):""]),occurrence=seen.get(identity)||0;seen.set(identity,occurrence+1);
   const key=`td:hours:${file}:${sheet.sheet_id}:${identity}:${occurrence}`;
   records.push({id:key,memberId,name,title:titleValue,matterTitle:managed?rowText(row,10):sheet.sheet_name,date,hours,workHours,entered:/^已录入|^已錄入/.test(rowText(row,6)),detail,sourceRefs:[key],localTaskId:localTaskId||undefined,localVersion:managed?rowText(row,12):undefined});
   if(!memberId)issues.push(`「${name}」未能對應本部門唯一成員，其 ${hours??"待確認"} 小時保留於同步明細，暫不計入成員總計。`);
   if(hours===null&&!managed)issues.push(`${name} · ${titleValue}：來源沒有可確認的時長，暫不計入。`);
  }
 }
 return {records,issues:[...new Set(issues)]};
}
export function taskSyncPayload(task:Task,members:Member[],matterTitle:string){
 const ids=task.memberIds?.length?task.memberIds:[""];
 return ids.map(memberId=>({key:`wb:${task.id}:${memberId||"unassigned"}`,taskId:task.id,memberId,name:members.find(m=>m.id===memberId)?.name||task.assignee||"",title:task.title,date:task.workDate||task.due?.slice(0,10)||"",status:task.status,hours:task.status==="done"&&typeof task.volunteerHours?.[memberId]==="number"?task.volunteerHours[memberId]:null,entered:task.volunteerEntered===true,matter:matterTitle,updatedAt:task.updatedAt}));
}
