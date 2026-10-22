import crypto from "node:crypto";
import {getCredential,saveCredentials} from "./vault";
import {assert,AppError} from "./errors";

export const TENCENT_CREDENTIAL="integration:tencent-docs";
export interface SheetInfo {sheet_id:string;sheet_name:string;row_count:number;col_count:number;sheet_type:string;hidden?:boolean}
export interface SheetCell {row:number;col:number;value_type:string;string_value?:string;number_value?:number;bool_value?:boolean;formula?:string}
export const tencentConnected=()=>Boolean(getCredential(TENCENT_CREDENTIAL)?.password);
export function saveTencentToken(token:string){assert(typeof token==="string"&&token.length>10&&token.length<16000,"騰訊文檔授權資料不正確");saveCredentials({[TENCENT_CREDENTIAL]:{username:"Tencent Docs MCP",password:token}});}

/** Official Tencent MCP endpoint only. Credentials never leave docs.qq.com. */
export async function tencentClient(){
 const token=getCredential(TENCENT_CREDENTIAL)?.password;assert(token,"請先授權騰訊文檔",400);
 let session="",sequence=0;
 async function rpc(method:string,params:unknown,notification=false):Promise<Record<string,unknown>>{
  const id=++sequence;let response:Response;
  try{response=await fetch("https://docs.qq.com/openapi/mcp",{method:"POST",redirect:"error",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",Authorization:token!,"MCP-Protocol-Version":"2024-11-05",...(session?{"Mcp-Session-Id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",...(!notification?{id}:{}),method,params}),signal:AbortSignal.timeout(30_000),cache:"no-store"});}
  catch{throw new AppError("騰訊文檔連接逾時，稍後重試；不會因此重複新增資料",502);}
  assert(response.ok,response.status===401||response.status===403?"騰訊文檔授權已失效或沒有編輯權限，請重新連接":"騰訊文檔暫時無法連接",502);
  session=response.headers.get("mcp-session-id")||session;if(notification||response.status===202)return {};
  const reader=response.body?.getReader();assert(reader,"騰訊文檔沒有回應",502);const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>10*1024*1024){await reader.cancel();throw new AppError("表格回應過大，請縮小同步範圍",502);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const raw=Buffer.concat(chunks).toString("utf8");
  let values:Record<string,unknown>[];try{values=response.headers.get("content-type")?.includes("event-stream")?raw.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trim()).join("\n")).filter(Boolean).map(v=>JSON.parse(v)):[JSON.parse(raw)];}catch{throw new AppError("騰訊文檔回應格式不正確",502);}
  const result=values.find(v=>v.id===id);assert(result&&!result.error,"騰訊文檔操作未成功，請檢查連接與權限",502);return result.result as Record<string,unknown>;
 }
 await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"personal-workbench",version:"1.0.0"}});await rpc("notifications/initialized",{},true);
 async function call<T>(name:string,args:unknown):Promise<T>{
  assert(["sheet.get_sheet_info","sheet.get_cell_data","sheet.set_range_value","sheet.get_merged_cells","sheet.insert_dimension"].includes(name),"不支援的表格操作");
  const r=await rpc("tools/call",{name,arguments:args});assert(!r.isError,"表格操作未成功，請確認騰訊文檔權限",502);
  let d=r.structuredContent as Record<string,unknown>|undefined;
  if(!d){const content=r.content as {type:string;text?:string}[]|undefined;try{d=JSON.parse(content?.find(c=>c.type==="text")?.text||"{}");}catch{throw new AppError("表格資料格式不正確",502);}}
  assert(d&&!d.error,"騰訊文檔拒絕了表格操作，請核對權限",502);return d as T;
 }
 return {
  info:(file_id:string)=>call<{sheets:SheetInfo[]}>("sheet.get_sheet_info",{file_id}),
  read:(file_id:string,sheet_id:string,end_row:number,end_col:number,start_row=0,start_col=0)=>call<{cells:SheetCell[]}>("sheet.get_cell_data",{file_id,sheet_id,start_row,end_row,start_col,end_col,return_csv:false,include_formula:true}),
  write:(file_id:string,sheet_id:string,values:SheetCell[])=>call("sheet.set_range_value",{file_id,sheet_id,values}),
  merges:(file_id:string,sheet_id:string)=>call<{merged_cells:string[]}>("sheet.get_merged_cells",{file_id,sheet_id}),
  insertRows:(file_id:string,sheet_id:string,index:number,count:number)=>call("sheet.insert_dimension",{file_id,sheet_id,index,count,dimension_type:"row",direction:"before"}),
 };
}
export function tencentAuthCode(){const code=crypto.randomBytes(24).toString("hex");return {code,url:`https://docs.qq.com/scenario/open-claw.html?nlc=1&authType=1&code=${code}&mcp_source=desktop`};}
