import {appendLog,mutateStore,newId,nowISO,readStore} from "../../store";
import {getResourceCredential,saveResourceCredentials,validResourceId,migrateResourceCredentials} from "../../vault";
import {AppError,assert} from "../../errors";
import {json,str} from "../http";
import type {Ctx} from "../ctx";
import type {Member,WorkResource,Store} from "../../types";
import {organizationFor,departmentProfiles} from "../../organizations";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import crypto from "node:crypto";
import {currentSession,SESSION_COOKIE,hashToken} from "../../auth";
import {verifyOwner,limitSource} from "../security";

export function resourceViews(){const resources=readStore().resources.filter(r=>validResourceId(r.id));migrateResourceCredentials(resources.map(r=>r.id));return resources.map(r=>{const c=getResourceCredential(r.id);return {...r,username:c?.username,hasCredential:Boolean(c?.password)};});}
export function memberIds(store:Store,value:unknown,department?:string):string[]{
  assert(Array.isArray(value),"参与部员格式不正确");
  const ids=[...new Set(value.map(String))];
  assert(ids.length<=100,"每次最多选择 100 位部员");
  assert(ids.every(id=>store.members.some(m=>m.id===id)),"参与部员中有不存在的记录，请刷新名单后重试");
  assert(!department||ids.every(id=>store.members.find(m=>m.id===id)?.department===department),"参与成员须属于当前组织和部门，请先切换归属或重新选择名单");
  return ids;
}
export async function importWorkspace(ctx:Ctx){
  const body=await ctx.body<Record<string,unknown>>();
  const rawMembers=Array.isArray(body.members)?body.members:[];
  const rawResources=Array.isArray(body.resources)?body.resources:[];
  assert(rawMembers.length<=200&&rawResources.length<=100,"导入记录数量超出限制");
  const resources:WorkResource[]=rawResources.map(raw=>{
    const r=raw as Record<string,unknown>,id=str(r.id,"",80),title=str(r.title,"",120);
    assert(validResourceId(id)&&title,"入口 ID 或名称无效，不能使用集成的保留名称");
    let url:URL;try{url=new URL(str(r.url,"",4000));}catch{throw new AppError("入口链接无效",400);}
    assert((url.protocol==="https:"||url.protocol==="http:")&&!url.username&&!url.password,"入口须使用不含账号密码的 http 或 https 链接");
    return {id,title,url:url.href,description:str(r.description,"",300),category:["设备","审核","团学","校园"].includes(String(r.category))?r.category as WorkResource["category"]:"团学",organization:r.organization==="个人"?"个人":r.organization==="示例组织一"?"示例组织一":"示例组织二"};
  });
  const members=rawMembers.map(raw=>{
    const m=raw as Record<string,unknown>,name=str(m.name,"",60).trim();assert(name,"部员姓名不能为空");
    const department=departmentProfiles(readStore().settings).some(p=>p.id===m.department)?String(m.department):"运营部";
    return {name,department,organization:organizationFor(department,readStore().settings),school:str(m.school,"",100),role:str(m.role,"",40),className:str(m.className,"",100),sourceNumber:Number.isInteger(m.sourceNumber)?Number(m.sourceNumber):undefined,source:str(m.source,"",200)} as Omit<Member,"id"|"createdAt">;
  });
  const credentials:Record<string,{username:string;password:string}>={};
  const available=new Set([...readStore().resources,...resources].map(r=>r.id));
  assert(!body.credentials||Object.keys(body.credentials as object).length<=100,"凭据数量超出限制");
  if(body.credentials&&typeof body.credentials==="object")for(const [id,raw] of Object.entries(body.credentials)){
    assert(validResourceId(id)&&available.has(id),"凭据没有对应的工作入口，或使用了保留名称");const c=raw as Record<string,unknown>;
    const username=str(c.username,"",200),password=str(c.password,"",500);assert(username&&password,"账号密码不能为空");credentials[id]={username,password};
  }
  if(Object.keys(credentials).length)await verifyOwner(ctx.req,body.current);
  const {result}=await mutateStore(s=>{
    let added=0;
    for(const m of members){const old=s.members.find(x=>x.name===m.name&&x.department===m.department);if(old)Object.assign(old,m);else{s.members.push({...m,id:newId("member"),createdAt:nowISO()});added++;}}
    for(const r of resources){const i=s.resources.findIndex(x=>x.id===r.id);if(i>=0)s.resources[i]=r;else s.resources.push(r);}
    if(Object.keys(credentials).length)saveResourceCredentials(credentials);
    appendLog(s,"workspace",`导入 ${added} 位部员，配置 ${resources.length} 个工作入口`);
    return {addedMembers:added,totalMembers:s.members.length,resources:resources.length,credentials:Object.keys(credentials).length};
  });return json({ok:true,...result});
}
export async function credential(ctx:Ctx){
  const body=await ctx.body<Record<string,unknown>>(),id=str(body.id,"",80);
  consumeAuthorization(ctx,id,"copy",body.authorization);
  assert(readStore().resources.some(r=>r.id===id),"工作入口不存在");
  const c=getResourceCredential(id);if(!c)throw new AppError("此入口尚未配置凭据",404);
  // Plaintext is returned only for an explicit copy action, never in workspace state.
  await mutateStore(s=>appendLog(s,"security",`读取工作入口凭据：${id}`));return json({username:c.username,password:c.password});
}
export async function loginLaunch(ctx:Ctx){
  const body=await ctx.body<Record<string,unknown>>(),id=str(body.id,"",80);
  consumeAuthorization(ctx,id,"login",body.authorization);
  assert(["device-admin","news-review"].includes(id),"此入口不支持账号自动登录");
  const resource=readStore().resources.find(r=>r.id===id);assert(resource,"工作入口不存在");
  const url=new URL(resource.url);assert(url.protocol==="https:"&&!url.username&&!url.password&&!url.port&&url.hostname===(id==="device-admin"?process.env.DEVICE_LOGIN_HOST:process.env.NEWS_LOGIN_HOST),"登录目标与预设站点不符");
  const c=getResourceCredential(id);assert(c,"尚未配置账号密码");await mutateStore(s=>appendLog(s,"security",`授权原站登录：${id}`));return json({url:resource.url,username:c.username,password:c.password});
}
const authorizations=new Map<string,{id:string;operation:string;session:string;expires:number}>();
export async function authorizeCredential(ctx:Ctx){
  const b=await ctx.body<Record<string,unknown>>(),id=str(b.id,"",80),operation=str(b.operation);
  assert(validResourceId(id)&&readStore().resources.some(r=>r.id===id),"工作入口无效");
  assert(operation==="copy"||operation==="login","操作无效");
  limitSource(ctx.req,"credential-authorization",12,60_000);await verifyOwner(ctx.req,b.current);
  const session=currentSession(ctx.req.cookies.get(SESSION_COOKIE)?.value);assert(session,"请重新登录",401);
  for(const [k,v] of authorizations)if(v.expires<Date.now())authorizations.delete(k);
  assert(authorizations.size<100,"授权请求过多，请稍后重试",429);
  const raw=crypto.randomBytes(32).toString("base64url");authorizations.set(hashToken(raw),{id,operation,session:session.id,expires:Date.now()+30_000});
  await mutateStore(s=>appendLog(s,"security",`二次验证工作入口：${id}（${operation==="copy"?"复制":"登录"}）`));return json({authorization:raw,expiresIn:30});
}
function consumeAuthorization(ctx:Ctx,id:string,operation:string,value:unknown){
  assert(validResourceId(id),"工作入口无效");const k=typeof value==="string"?hashToken(value):"",entry=authorizations.get(k);authorizations.delete(k);
  assert(entry&&entry.id===id&&entry.operation===operation&&entry.expires>=Date.now()&&entry.session===currentSession(ctx.req.cookies.get(SESSION_COOKIE)?.value)?.id,"请重新验证主账号密码后再操作",403);
}
export async function browserHelper(){
  const zip=new JSZip();
  const origins=["http://127.0.0.1:3939","http://localhost:3939"];
  if(process.env.WORKBENCH_PUBLIC_URL){const url=new URL(process.env.WORKBENCH_PUBLIC_URL);if(url.protocol==="https:"&&!url.username&&!url.password)origins.push(url.origin);}
  for(const name of ["manifest.json","workbench.js","background.js","form-fill.js","frame-fill.js","README.txt"]){
    let source=fs.readFileSync(path.join(process.cwd(),"browser-helper",name),"utf8");
    if(name==="manifest.json"){const manifest=JSON.parse(source);manifest.host_permissions=[...new Set([...manifest.host_permissions,...origins.map(o=>`${o}/*`)])];manifest.content_scripts[0].matches=origins.map(o=>`${o}/*`);source=JSON.stringify(manifest,null,2);}
    if(name==="background.js"||name==="frame-fill.js")source=source.replace('["http://127.0.0.1:3939","http://localhost:3939"]',JSON.stringify(origins));
    if(name==="README.txt")source+=`\n本次生成的工作台来源：${origins.join("、")}。仅信任你自己的工作台。\n`;
    zip.file(name,source);
  }
  const bytes=await zip.generateAsync({type:"nodebuffer"});return new Response(new Uint8Array(bytes),{headers:{"content-type":"application/zip","content-disposition":"attachment; filename=workbench-login-helper.zip","cache-control":"no-store"}});
}
