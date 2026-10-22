import {getCredential,saveCredentials} from "./vault";
import {assert,AppError} from "./errors";
import {kdocsDatabase} from "./kdocs-database";
export const KDOCS_CREDENTIAL="integration:kdocs";
export interface KdocsSheet {sheetId:number;sheetName:string;rowFrom:number;rowTo:number;colFrom:number;colTo:number;isVisible:boolean;sheetType:string;links?:{col:number;sheetId:number;primaryColumn:number}[]}
export interface KdocsCell {rowFrom:number;rowTo:number;colFrom:number;colTo:number;cellText?:string;originalCellValue?:unknown;fmlaText?:string;isCellPic?:boolean;recordId?:string}
export function parseKdocsResponse(raw:string){
 let data:Record<string,unknown>;try{const events=raw.split(/\r?\n\r?\n/).filter(e=>/^event:\s*result\s*$/m.test(e));data=JSON.parse(events.length?events.at(-1)!.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5)).join("\n"):raw);}catch{throw new AppError("金山文檔回應格式無法辨識",502);}
 for(let depth=0;depth<5&&data&&typeof data==="object"&&"code"in data;depth++){assert(data.code===0||data.code===200,"金山文檔操作未完成，請核對文件類型及權限",502);if(data.data&&typeof data.data==="object")data=data.data as Record<string,unknown>;else break;}
 assert(data&&typeof data==="object"&&!Array.isArray(data),"金山文檔回應格式無法辨識",502);return data;
}
export const kdocsConnected=()=>Boolean(getCredential(KDOCS_CREDENTIAL)?.password);
export function kdocsUrl(value:unknown){let url:URL;try{url=new URL(String(value));}catch{throw new AppError("請填寫金山文檔分享連結");}assert(url.protocol==="https:"&&["www.kdocs.cn","kdocs.cn","365.kdocs.cn"].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&/^\/l\/[A-Za-z0-9_-]{5,100}\/?$/.test(url.pathname),"請使用 https://www.kdocs.cn/l/… 的分享連結");return `https://www.kdocs.cn${url.pathname.replace(/\/$/,"")}`;}
export function saveKdocsToken(token:string){assert(typeof token==="string"&&token.length>15&&token.length<16000,"金山文檔授權資料不正確");saveCredentials({[KDOCS_CREDENTIAL]:{username:"KDocs official API",password:token}});}
export function kdocsClient(explicitToken?:string){
 const token=explicitToken||getCredential(KDOCS_CREDENTIAL)?.password;assert(token,"請先完成金山文檔官方授權。分享連結的網頁編輯權限與背景同步授權分開。");
 async function call<T>(tool:string,args:unknown):Promise<T>{
  assert(["get_file_info","sheet.get_sheets_info","sheet.get_range_data","sheet.range_data_batch_update","dbsheet.get_schema","dbsheet.list_records","dbsheet.create_records","dbsheet.update_records"].includes(tool),"不支援的金山文檔操作");
  let r:Response;try{r=await fetch("https://mcp-center.wps.cn/skill_hub/api/v1/tool",{method:"POST",redirect:"error",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`,"X-Skill-Version":"2.7.1"},body:JSON.stringify({tool,args}),cache:"no-store",signal:AbortSignal.timeout(30000)});}catch{throw new AppError("金山文檔連接逾時，稍後重試",502);}
  assert(r.status!==401&&r.status!==403,"金山文檔尚未授權、授權已失效，或帳號沒有這份文件的權限",502);assert(r.ok,"金山文檔暫時無法連接",502);
  const reader=r.body?.getReader();assert(reader,"金山文檔沒有回應",502);const chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>10*1024*1024){await reader.cancel();throw new AppError("表格內容過大，請縮小範圍",502);}chunks.push(part.value);}}finally{reader.releaseLock();}
  return parseKdocsResponse(Buffer.concat(chunks).toString("utf8")) as T;
 }
 const database=kdocsDatabase(call);let mode:Promise<boolean>|undefined;
 const isDatabase=(url:string)=>mode??=call<{name?:string}>("get_file_info",{url:kdocsUrl(url)}).then(info=>Boolean(info.name?.endsWith(".dbt")));
 return {
  info:async(url:string)=>await isDatabase(url)?database.info(kdocsUrl(url)):call<{sheetsInfo:KdocsSheet[]}>("sheet.get_sheets_info",{url:kdocsUrl(url)}),
  read:async(url:string,sheetId:number,rowFrom:number,rowTo:number,colFrom:number,colTo:number)=>await isDatabase(url)?database.read(kdocsUrl(url),sheetId,rowFrom,rowTo,colFrom,colTo):call<{detail:{rangeData:KdocsCell[]}}>("sheet.get_range_data",{url:kdocsUrl(url),worksheet_id:sheetId,range:{rowFrom,rowTo,colFrom,colTo}}),
  write:async(url:string,sheetId:number,cells:{row:number;col:number;value:string|number}[])=>await isDatabase(url)?database.write(kdocsUrl(url),sheetId,cells):call("sheet.range_data_batch_update",{url:kdocsUrl(url),worksheet_id:sheetId,range_data:cells.map(c=>({op_type:"cell_operation_type_formula",row_from:c.row,row_to:c.row,col_from:c.col,col_to:c.col,formula:String(c.value).replace(/^[=+@-]/,"'$&")}))}),
 };
}
