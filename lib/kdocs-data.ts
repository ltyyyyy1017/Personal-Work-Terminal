import {Converter} from "opencc-js/cn2t";
import type {KdocsCell,KdocsSheet} from "./kdocs";
import type {KdocsMapping,Member} from "./types";
import {PERFORMANCE_RULES} from "./performance-rules";
import {digest,sheetDate} from "./team-sheet-data";
const traditional=Converter({from:"cn",to:"hk"});
export const kdocsNormalize=(v:string)=>traditional(v).normalize("NFKC").replace(/\s+/g,"").replace(/恆/g,"恒").toLocaleLowerCase();
export const kdocsText=(c:KdocsCell|undefined)=>String(c?.cellText??c?.originalCellValue??"").trim();
export function kdocsRows(cells:KdocsCell[]){const rows=new Map<number,Map<number,string>>();for(const c of cells){if(!rows.has(c.rowFrom))rows.set(c.rowFrom,new Map());rows.get(c.rowFrom)!.set(c.colFrom,kdocsText(c));}return rows;}
export function suggestKdocsMapping(sheetId:number,cells:KdocsCell[]):KdocsMapping|undefined{
 for(const [row,columns]of [...kdocsRows(cells)].sort((a,b)=>a[0]-b[0]).filter(([r])=>r<30)){
  const find=(re:RegExp)=>[...columns].find(([,text])=>re.test(text))?.[0];
  const title=find(/^(工作事项|工作事項|工作内容|工作內容|任务|任務|工作项目|工作項目|事项|事項|活动名称|活動名稱)$/),member=find(/^(姓名|成员|成員|参与人|參與人|参与成员|參與成員|执行人|執行人|項目執行者|项目执行者|负责人|負責人)$/);
  if(title!==undefined&&member!==undefined)return {sheetId,headerRow:row,titleColumn:title,memberColumn:member,dateColumn:find(/^(日期|工作日期|完成日期|活动日期|活動日期|时间|時間|结束时间|結束時間)$/),activityColumn:find(/^(所属活动|所屬活動|活动|活動|大事项|大事項|所属项目|所屬項目)$/),noteColumn:find(/^(备注|備註|说明|說明)$/),statusColumn:find(/^(状态|狀態|完成情况|完成情況|进度|進度)$/),ruleColumn:find(/^(考核项目|考核項目|绩效项目|績效項目)$/),detailColumn:find(/^(具体内容|具體內容)$/),scoreColumn:find(/^(绩效分数|績效分數)$/),categoryColumn:find(/^(所属类型|所屬類型)$/)};
 }
}
export interface KdocsRecord {key:string;sheetId:number;sheetName:string;row:number;recordId?:string;projectId?:string;fingerprint:string;taskStatus:"doing"|"done";sourceStatus:string;score?:number;sourceCategory?:string;title:string;matter:string;date:string;names:string[];memberIds:string[];status:"done"|"leave"|"no-score";note:string;rule?:keyof typeof PERFORMANCE_RULES;phase?:"pre"|"post"}
export function parseKdocsSheet(sheet:KdocsSheet,cells:KdocsCell[],mapping:KdocsMapping,members:Member[],year:number){
 const issues:string[]=[],records:KdocsRecord[]=[],seen=new Map<string,number>();
 for(const [row,cols]of [...kdocsRows(cells)].sort((a,b)=>a[0]-b[0])){
  if(row<=mapping.headerRow)continue;const text=(col:number|undefined)=>col===undefined?"":cols.get(col)||"",title=text(mapping.titleColumn),name=text(mapping.memberColumn);
  if(!title&&!name)continue;if(!title||!name){issues.push(`${sheet.sheetName} 第 ${row+1} 行：缺少工作事項或姓名，保留原表待核對。`);continue;}
  if(/^(合计|合計|总计|總計|示例|範例|填写说明|填寫說明)/.test(title)||/^(姓名|xxx|示例|範例)$/.test(name))continue;
  const names=[...new Set(name.split(/[、,，;；\n/]+/).map(s=>s.trim()).filter(Boolean))],ids:string[]=[];
  for(const n of names){const matches=members.filter(m=>m.department==="行政部"&&kdocsNormalize(m.name)===kdocsNormalize(n));if(matches.length===1)ids.push(matches[0].id);else issues.push(`${sheet.sheetName}：「${n}」未對應唯一行政部成員，來源姓名及工作保留，暫不計績效。`);}
  const rawDate=text(mapping.dateColumn),date=sheetDate(rawDate,year);if(!date)issues.push(`${sheet.sheetName} 第 ${row+1} 行：缺少明確日期，保留工作記錄，不補成今天，也不自動計次。`);
  const ruleText=text(mapping.ruleColumn);let rule=mapping.rule as keyof typeof PERFORMANCE_RULES|undefined;
  if(ruleText){rule=(Object.keys(PERFORMANCE_RULES) as (keyof typeof PERFORMANCE_RULES)[]).find(k=>kdocsNormalize(PERFORMANCE_RULES[k].name)===kdocsNormalize(ruleText)||k===ruleText);}
  if(rule&&!Object.hasOwn(PERFORMANCE_RULES,rule))rule=undefined;
  const statusText=text(mapping.statusColumn),taskStatus=sheet.sheetType==="db"&&/未开始|未開始|进行|進行|停滞|停滯|未完成/.test(statusText)?"doing":"done",status=/请假|請假/.test(statusText)?"leave":taskStatus==="doing"?"no-score":/未完成|未通过|未通過|取消|不计|不計/.test(statusText)?"no-score":"done";
  const matter=text(mapping.activityColumn)||sheet.sheetName,identity=digest([sheet.sheetId,kdocsNormalize(title),names.map(kdocsNormalize).sort(),date||rawDate]),occurrence=seen.get(identity)||0;seen.set(identity,occurrence+1);
  const projectRaw=cells.find(c=>c.rowFrom===row&&c.colFrom===mapping.activityColumn)?.originalCellValue as {value?:{id:string}[]}|undefined;const projectId=Array.isArray(projectRaw?.value)&&projectRaw.value.length===1?projectRaw.value[0].id:undefined;
  const recordId=cells.find(c=>c.rowFrom===row&&c.recordId)?.recordId,rawScore=text(mapping.scoreColumn),score=rawScore!==""&&Number.isFinite(Number(rawScore))?Number(rawScore):undefined;
  records.push({key:recordId?`kd:record:${sheet.sheetId}:id:${recordId}`:`kd:record:${sheet.sheetId}:${identity}:${occurrence}`,recordId,projectId,fingerprint:digest(cells.filter(c=>c.rowFrom===row).map(c=>[c.colFrom,kdocsText(c)]).sort((a,b)=>Number(a[0])-Number(b[0]))),taskStatus,sourceStatus:statusText,score,sourceCategory:text(mapping.categoryColumn),sheetId:sheet.sheetId,sheetName:sheet.sheetName,row,title,matter,date,names,memberIds:ids,status,note:text(mapping.detailColumn)&&text(mapping.noteColumn)&&text(mapping.detailColumn).includes(text(mapping.noteColumn))?text(mapping.detailColumn):[text(mapping.detailColumn),text(mapping.noteColumn)].filter(Boolean).join("\n"),rule,phase:rule==="materials"?mapping.phase:undefined});
 }
 return{records,issues:[...new Set(issues)]};
}
