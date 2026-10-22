import {readStore,mutateStore} from "./store";
import {assert} from "./errors";
import {cellValue,sheetRows,normalized,taskSyncPayload,digest} from "./team-sheet-data";
import type {tencentClient,SheetInfo,SheetCell} from "./tencent-docs";
import type {Task,TeamSheetState,NativeSheetLink} from "./types";
type Client=Awaited<ReturnType<typeof tencentClient>>;
type Values=NativeSheetLink["after"];
export const nativeTaskHash=(t:Task)=>digest([t.sheetDestination,t.title,t.memberIds,t.status,t.volunteerHours,t.volunteerEntered,t.workDate,t.due,t.updatedAt]);
const value=(cells:SheetCell[],row:number,col:number)=>{const cell=cells.find(c=>c.row===row&&c.col===col);return cell?cellValue(cell):"";};
const same=(cells:SheetCell[],row:number,want:Values)=>want.every(c=>value(cells,row,c.col)===c.value);
export async function nativeSnapshot(client:Client,file:string,id:string){
 const info=await client.info(file),sheet=info.sheets.find(s=>s.sheet_id===id);assert(sheet&&!sheet.hidden&&sheet.sheet_type==="worksheet","目標頁籤已移除或不可編輯，請重新選擇",409);assert(sheet.row_count<=5000&&sheet.col_count<=200,"目標頁籤過大");
 const cells:SheetCell[]=[];for(let row=0;row<sheet.row_count;row+=250)cells.push(...(await client.read(file,id,Math.min(sheet.row_count-1,row+249),Math.min(sheet.col_count-1,30),row)).cells);return {sheet,cells};
}
function locate(link:NativeSheetLink,cells:SheetCell[]){
 const previous=link.previous||link.before;
 for(const pattern of [link.after,previous])if(pattern.some(c=>c.value!=="")){
  const found=[...new Set(cells.map(c=>c.row))].filter(row=>same(cells,row,pattern));
  assert(found.length<=1,"目標表出現重複記錄，請先核對",409);if(found.length===1)return found[0];
 }
 assert(same(cells,link.row,previous)||same(cells,link.row,link.after),"原表記錄已被人工修改或移動，已停止覆寫，請先核對",409);return link.row;
}
async function saveLinks(id:string,links:NativeSheetLink[]){await mutateStore(s=>{assert(s.teamSheets,"同步設定不存在");s.teamSheets.nativeLinks??={};s.teamSheets.nativeLinks[id]=links;});}
async function writeLink(client:Client,link:NativeSheetLink,config:TeamSheetState){
 const active=()=>{const c=readStore().teamSheets;assert(c?.enabled&&c.taskFileId===config.taskFileId&&c.hoursFileId===config.hoursFileId,"同步設定已改動，已停止寫入",409);};active();
 const snap=await nativeSnapshot(client,link.file,link.sheet),row=locate(link,snap.cells);link.row=row;
 if(!same(snap.cells,row,link.after)){
  assert(!snap.cells.some(c=>c.row===row&&link.after.some(v=>v.col===c.col)&&c.formula),"目標欄位含公式，已保留公式並停止覆寫",409);
  active();await client.write(link.file,link.sheet,link.after.map(c=>typeof c.value==="number"?{row,col:c.col,value_type:"NUMBER",number_value:c.value}:{row,col:c.col,value_type:"STRING",string_value:c.value}));
 }
 const verify=await client.read(link.file,link.sheet,row,6,row);assert(same(verify.cells,row,link.after),"原表寫入後核對未通過，重試會更新同一筆記錄",502);
 link.previous=undefined;
}
function mergedRows(ranges:string[],cols:number[]){const blocked=new Set<number>();const column=(s:string)=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;for(const range of ranges){const match=range.match(/\$?([A-Z]+)(\d+):\$?([A-Z]+)(\d+)$/i);if(!match)continue;const left=column(match[1].toUpperCase()),right=column(match[3].toUpperCase());if(cols.some(c=>c>=left&&c<=right))for(let r=+match[2]-1;r<+match[4];r++)blocked.add(r);}return blocked;}
async function reserveRow(client:Client,file:string,sheetId:string,kind:"task"|"hours",department:string){
 let snap=await nativeSnapshot(client,file,sheetId);const rows=sheetRows(snap.cells),columns=kind==="task"?[1,2,3,5]:[1,2,3,4,5,6];let start=1,end=snap.sheet.row_count;
 if(kind==="task"){
  const headers=[...rows].filter(([,r])=>/部[（(]|主席团|主席團|统筹[（(]|統籌[（(]/.test(String(r.get(0)||""))).sort((a,b)=>a[0]-b[0]);
  const section=headers.find(([,r])=>normalized(String(r.get(0))).includes(normalized(department)));
  if(!section){
   assert([...rows.values()].some(r=>/任务|任務/.test(String(r.get(2)||""))&&String(r.get(3)||"")==="姓名"),"這個頁籤不是任務明細格式，請重新選擇",409);
   const next=Math.max(0,...snap.cells.filter(c=>c.col<=6&&String(cellValue(c)).trim()!=="").map(c=>c.row))+1;
   if(next+2>=snap.sheet.row_count)await client.insertRows(file,sheetId,snap.sheet.row_count-1,3);
   await client.write(file,sheetId,[{row:next,col:0,value_type:"STRING",string_value:`${department}（僅部長填寫）`}]);return reserveRow(client,file,sheetId,kind,department);
  }
  start=section[0]+1;end=headers.find(([r])=>r>section[0])?.[0]??snap.sheet.row_count;
 }else{
  assert(String(rows.get(0)?.get(1)||"")==="姓名"&&/部门|部門|任务|任務/.test(String(rows.get(0)?.get(2)||"")),"請選擇含姓名、部門及線上／線下時長的原有志願時頁籤",409);
  start=Math.max(1,...snap.cells.filter(c=>c.col<=6&&String(cellValue(c)).trim()!=="").map(c=>c.row+1));
 }
 const blocked=mergedRows((await client.merges(file,sheetId)).merged_cells||[],columns);
 for(let r=start;r<end;r++)if(!blocked.has(r)&&Array.from({length:7},(_,col)=>col).every(col=>col===0||!String(value(snap.cells,r,col)).trim())&&!snap.cells.some(c=>c.row===r&&c.col<=6&&c.formula))return r;
 // Insert at the section boundary rather than overwriting another department.
 const index=kind==="task"?end:Math.min(start,snap.sheet.row_count-1);await client.insertRows(file,sheetId,index,1);snap=await nativeSnapshot(client,file,sheetId);
 assert(columns.every(col=>value(snap.cells,index,col)===""),"新插入行尚未可用，請重試",409);return index;
}
export async function syncNativeTask(client:Client,config:TeamSheetState,task:Task|undefined,id:string){
 let links=structuredClone(readStore().teamSheets?.nativeLinks?.[id]||[]);
 const dest=task?.reportToTeamSheets===true?task.sheetDestination:undefined;
 const members=readStore().members,payload=task&&dest?taskSyncPayload(task,members,readStore().matters.find(m=>m.id===task.matterId)?.title||""):[];
 const wanted=new Set(payload.flatMap(p=>[`${config.taskFileId}:${dest!.taskSheetId}:task:${p.memberId}`,`${config.hoursFileId}:${dest!.hoursSheetId}:hours:${p.memberId}`]));
 for(const link of [...links])if(!wanted.has(`${link.file}:${link.sheet}:${link.kind}:${link.memberId}`)){
  // Restore pre-existing source rows; remove only values we added to blank rows.
  const cleanup={...link,previous:link.previous||link.after,after:link.before};await saveLinks(id,links.map(l=>l===link?cleanup:l));await writeLink(client,cleanup,config);links=links.filter(l=>l!==link);await saveLinks(id,links);
 }
 for(const p of payload)for(const kind of ["task","hours"] as const){
  const file=kind==="task"?config.taskFileId:config.hoursFileId,sheet=kind==="task"?dest!.taskSheetId:dest!.hoursSheetId;
  let link=links.find(l=>l.file===file&&l.sheet===sheet&&l.kind===kind&&l.memberId===p.memberId);
  const cols=kind==="task"?[1,2,3,5]:[1,2,3,4,5,6];
  if(!link){
   const snap=await nativeSnapshot(client,file,sheet),origin=task?.sheetOrigin?.[kind];let row:number,owned=true;
   if(origin?.sheetId===sheet&&(kind!=="task"||task?.memberIds?.length===1||"rows" in origin&&origin.rows?.[p.memberId]!==undefined)){row=(kind==="task"&&"rows" in origin?origin.rows?.[p.memberId]:undefined)??origin.row;const expectedName=kind==="task"?3:1;assert(normalized(String(value(snap.cells,row,expectedName)))===normalized(p.name),"來源表的姓名或行號已變動，請先重新讀取表格",409);owned=false;}
   else{
    // A task already present in the selected assignment page is adopted, not duplicated.
    const matches=kind==="task"?[...sheetRows(snap.cells)].filter(([,r])=>normalized(String(r.get(2)||""))===normalized(p.title)&&normalized(String(r.get(3)||""))===normalized(p.name)):[];
    assert(matches.length<=1,"原表已有多筆相同任務，請先核對",409);
    if(matches.length){row=matches[0][0];owned=false;}else row=await reserveRow(client,file,sheet,kind,config.department);
   }
   const current=await nativeSnapshot(client,file,sheet);link={file,sheet,kind,memberId:p.memberId,row,owned,before:cols.map(col=>({col,value:value(current.cells,row,col) as string|number})),after:[]};links.push(link);
  }
  let after:Values;
  if(kind==="task")after=[{col:1,value:p.date},{col:2,value:[p.title,p.description].filter(Boolean).join("\n")},{col:3,value:p.name},{col:5,value:p.status==="done"?"已完成":p.status==="review"?"審核中":"待完成"}];
  else{
   const source=task?.sheetOrigin?.hours?.sheetId===sheet&&!link.owned;
   const header=await client.read(file,sheet,0,6),departmentColumn=/部门|部門/.test(String(value(header.cells,0,2)));
   const sourceDetail=(col:number)=>{const raw=String(link!.before.find(c=>c.col===col)?.value||"");return p.hours===null?raw.replace(/\d+(?:\.\d+)?\s*(?:h|小时|小時)/gi,""):raw;};
   const detail=p.hours===null?p.title:`${p.title} ${p.hours}h`,online=dest!.hoursKind==="online";
   after=[{col:1,value:p.name},{col:2,value:departmentColumn?config.department:p.title},{col:3,value:source?sourceDetail(3):online?detail:""},{col:4,value:source?sourceDetail(4):online?"":detail},{col:5,value:p.hours??""},{col:6,value:p.entered?"已錄入":"未錄入"}];
  }
  // Journal before the request: a lost response resumes at the same row.
  if(JSON.stringify(link.after)!==JSON.stringify(after)){link.previous=link.after.length?link.after:link.before;link.after=after;}
  await saveLinks(id,links);await writeLink(client,link,config);await saveLinks(id,links);
 }
 if(!links.length)await mutateStore(s=>{if(s.teamSheets?.nativeLinks)delete s.teamSheets.nativeLinks[id];});
}
