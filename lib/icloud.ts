import {DAVClient,type DAVCalendar} from "tsdav";
import ICAL from "ical.js";
import {createHash} from "node:crypto";
import {AppError,assert} from "./errors";
import type {CalEvent} from "./types";

export const cloudId=(value:string)=>createHash("sha256").update(value).digest("hex").slice(0,24);
export function appleUrl(value:string){const u=new URL(value);assert(u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&/^(?:caldav|p\d+-caldav)\.icloud\.com(?:\.cn)?$/.test(u.hostname),"iCloud 返回了不支持的日历地址");return u;}
export const appleFetch:typeof fetch=async(input,init)=>{
  let url=appleUrl(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  for(let i=0;i<5;i++){
    const res=await fetch(url,{...init,redirect:"manual",cache:"no-store",signal:init?.signal||AbortSignal.timeout(20000)});
    if([301,302,303,307,308].includes(res.status)){const target=res.headers.get("location");assert(target,"iCloud 重定向地址缺失",502);url=appleUrl(new URL(target,url).href);continue;}
    if(res.status===401)throw new AppError("Apple 账户验证未通过（401）。请核对账户及仍有效的 App 专用密码，再重新连接。",401);
    if(res.status===403)throw new AppError(["PUT","DELETE","MKCALENDAR"].includes(String(init?.method))?"此 iCloud 日历不允许写入（403），请改选你有编辑权限的日历。":"Apple 拒绝访问此日历（403），请核对账户的日历访问权限。",403);
    assert(res.status!==429,"iCloud 请求过于频繁，请稍后重试",429);
    if(res.status===204||!res.body)return res;
    const reader=res.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024){await reader.cancel();throw new AppError("日历数据过大，请缩短读取日期范围",413);}chunks.push(value);}
    return new Response(Buffer.concat(chunks),{status:res.status,statusText:res.statusText,headers:res.headers});
  }throw new AppError("iCloud 重定向次数过多",502);
};
export async function cloudClient(credentials:{username:string;password:string},transport:typeof fetch=appleFetch){
  const client=new DAVClient({serverUrl:"https://caldav.icloud.com",credentials,authMethod:"Basic",defaultAccountType:"caldav",fetch:transport,fetchOptions:{signal:AbortSignal.timeout(60000)}});
  await client.login();return client;
}
export async function readCloudObject(url:string,credentials:{username:string;password:string},transport:typeof fetch=appleFetch){
  appleUrl(url);const response=await transport(url,{method:"GET",headers:{Authorization:`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`},signal:AbortSignal.timeout(20000)});
  if(response.status===404)return undefined;assert(response.ok,`iCloud 日程读取失败（${response.status}）`,502);return {url,etag:response.headers.get("etag")||undefined,data:await response.text()};
}
export function calendarViews(calendars:DAVCalendar[]){return calendars.filter(c=>!c.components||c.components.includes("VEVENT")).map(c=>({id:cloudId(appleUrl(c.url).href),url:appleUrl(c.url).href,name:typeof c.displayName==="string"?c.displayName:"未命名日历",color:c.calendarColor}));}
const localTime=(t:ICAL.Time)=>{
  if(t.isDate)return t.toString().slice(0,10);
  // Floating times use the workbench's Asia/Shanghai timezone; UTC/TZID values are converted.
  if(t.zone.tzid==="floating")return t.toString().slice(0,16);
  const f=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});return f.format(t.toJSDate()).replace(" ","T");
};
export function decodeCloudEvents(data:string,from:string,to:string){
  const root=new ICAL.Component(ICAL.parse(data));for(const tz of root.getAllSubcomponents("vtimezone")){const id=tz.getFirstPropertyValue("tzid");if(typeof id==="string")ICAL.TimezoneService.register(new ICAL.Timezone(tz),id);}
  const components=root.getAllSubcomponents("vevent"),out:{uid:string;instance:string;title:string;start:string;end?:string;allDay:boolean;location:string;description:string}[]=[];
  for(const component of components){
    if(component.getFirstPropertyValue("status")==="CANCELLED")continue;
    const ev=new ICAL.Event(component,{strictExceptions:false});if(!ev.uid||!ev.startDate)continue;
    if(ev.isRecurring())throw new AppError("iCloud 未展开重复日程，请缩短日期范围后重试",502);
    const start=localTime(ev.startDate),end=ev.endDate?localTime(ev.endDate):undefined;
    if(start.slice(0,10)>to||(end||start).slice(0,10)<from)continue;
    out.push({uid:ev.uid,instance:String(component.getFirstPropertyValue("recurrence-id")||""),title:ev.summary||"无标题日程",start,end,allDay:ev.startDate.isDate,location:ev.location||"",description:ev.description||""});
  }return out;
}
export const eventUid=(id:string)=>`workbench-${id}@personal-workbench.local`;
export function encodeCloudEvent(event:CalEvent){
  const root=new ICAL.Component(["vcalendar",[],[]]);root.updatePropertyWithValue("version","2.0");root.updatePropertyWithValue("prodid","-//Personal Workbench//iCloud Calendar//ZH");
  const comp=new ICAL.Component("vevent"),ev=new ICAL.Event(comp);root.addSubcomponent(comp);ev.uid=eventUid(event.id);ev.summary=event.title;ev.location=event.location||"";ev.description=event.description||"";
  const convert=(value:string)=>event.allDay?ICAL.Time.fromDateString(value.slice(0,10)):ICAL.Time.fromJSDate(new Date(`${value.length===16?value+":00":value}+08:00`),true);
  ev.startDate=convert(event.start);if(event.end)ev.endDate=convert(event.end);else{const end=ev.startDate.clone();end.addDuration(ICAL.Duration.fromSeconds(event.allDay?86400:3600));ev.endDate=end;}
  comp.updatePropertyWithValue("dtstamp",ICAL.Time.fromJSDate(new Date(),true));return root.toString()+"\r\n";
}
