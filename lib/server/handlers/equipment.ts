import {getResourceCredential} from "../../vault";
import {AppError,assert} from "../../errors";
import {json,str} from "../http";
import type {Ctx} from "../ctx";
import {equipmentBorrowings} from "../../equipment-borrowings";

const base=()=>{const value=process.env.EQUIPMENT_BASE_URL;assert(value,"尚未配置设备服务地址");const url=new URL(value);assert(url.protocol==="https:","设备服务必须使用 HTTPS");return url.origin;};
let session="",loginPending:Promise<void>|null=null;
async function authenticate(){
  if(loginPending)return loginPending;
  loginPending=(async()=>{const credentials=getResourceCredential("device-admin");assert(credentials,"请先配置设备后台账号");const response=await fetch(`${base()}/api/admin/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(credentials),signal:AbortSignal.timeout(15000)});if(!response.headers.get("content-type")?.includes("application/json"))throw new AppError("设备原站暂时不可用，请稍后重试或打开原站窗口",502);const data=await response.json();if(!response.ok||!data.success||!data.sessionId)throw new AppError(data.message||"设备后台登录失败",502);session=data.sessionId;})();
  try{await loginPending;}finally{loginPending=null;}
}
async function remote(path:string,method="GET",body?:unknown,retry=true):Promise<Record<string,unknown>>{
  if(!session)await authenticate();
  const response=await fetch(`${base()}${path}`,{method,headers:{"x-session-id":session,...(body instanceof FormData?{}:body?{"content-type":"application/json"}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),cache:"no-store"});
  if((response.status===401||response.status===403)&&retry){session="";await authenticate();return remote(path,method,body,false);}
  if(!response.headers.get("content-type")?.includes("application/json"))throw new AppError("设备原站暂时不可用，请稍后重试或打开原站窗口",502);
  const data=await response.json();if(!response.ok||data.success===false)throw new AppError(data.message||"设备站暂时无法完成请求",502);return data;
}
export async function snapshot(){
  const [devices,records,categories]=await Promise.all([remote("/api/devices"),remote("/api/records/active"),remote("/api/categories")]);
  return json({devices:devices.data||[],records:records.data||[],categories:categories.data||[],fetchedAt:new Date().toISOString(),baseUrl:base(),organization:"示例组织二"});
}
export async function borrowed(){
  const [devices,records]=await Promise.all([remote("/api/devices"),remote("/api/records/active")]);
  assert(Array.isArray(devices.data)&&Array.isArray(records.data),"设备站返回的数据格式有变化，请在原站核对",502);
  return json({items:equipmentBorrowings(devices.data,records.data),fetchedAt:new Date().toISOString(),organization:"示例组织二"});
}
export async function patchDevice(ctx:Ctx){
  assert(/^[\w-]+$/.test(ctx.params.id),"设备编号无效");const body=await ctx.body<Record<string,unknown>>();const form=new FormData();
  for(const key of ["name","model","location","notes","category"])form.set(key,str(body[key],"",key==="notes"?2000:200));
  assert(form.get("name"),"设备名称不能为空");
  await remote(`/api/devices/${encodeURIComponent(ctx.params.id)}`,"PUT",form);return json({ok:true});
}
export async function operationalStatus(ctx:Ctx){
  assert(/^[\w-]+$/.test(ctx.params.id),"设备编号无效");const body=await ctx.body<Record<string,unknown>>();assert(body.operationalStatus==="online"||body.operationalStatus==="offline","设备状态无效");
  await remote(`/api/devices/${encodeURIComponent(ctx.params.id)}/operational-status`,"PUT",{operationalStatus:body.operationalStatus,offlineReason:str(body.offlineReason,"",500)});return json({ok:true});
}
