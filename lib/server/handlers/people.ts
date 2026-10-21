import {mutateStore,newId,nowISO,readStore,dirs,ensureDirs} from "../../store";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {assert,AppError} from "../../errors";
import {json,str,isDateLike} from "../http";
import {applyVolunteer} from "./records";
import {memberIds} from "./workspace";
import type {Ctx} from "../ctx";
import type {WorkLog} from "../../types";

export async function patchMember(ctx:Ctx){
  let b:Record<string,unknown>,upload:File|undefined;
  if(ctx.req.headers.get("content-type")?.includes("multipart/form-data")){
    assert(Number(ctx.req.headers.get("content-length")||0)<=6*1024*1024,"头像最大 5 MB",413);
    const form=await ctx.form();b=Object.fromEntries(form.entries());const image=form.get("avatar");if(image instanceof File&&image.size)upload=image;
  }else b=await ctx.body<Record<string,unknown>>();
  let avatar:string|undefined;
  if(upload){
    assert(readStore().members.some(m=>m.id===ctx.params.id),"成员不存在",404);
    assert(upload.size<=5*1024*1024,"头像最大 5 MB",413);
    assert(["image/jpeg","image/png","image/webp"].includes(upload.type),"请选择 JPG、PNG 或 WebP 图片");
    let image:Buffer;try{
      const input=Buffer.from(await upload.arrayBuffer()),meta=await sharp(input,{limitInputPixels:25_000_000}).metadata();
      assert(["jpeg","png","webp"].includes(meta.format||""),"请选择 JPG、PNG 或 WebP 图片");
      image=await sharp(input,{limitInputPixels:25_000_000}).rotate().resize(512,512,{fit:"cover",position:"centre"}).webp({quality:85}).toBuffer();
    }catch{throw new AppError("图片无法读取，请换一张 JPG、PNG 或 WebP 图片（最大 2500 万像素）");}
    ensureDirs();avatar=`${newId("avatar")}.webp`;fs.writeFileSync(path.join(dirs.avatars,avatar),image,{flag:"wx"});
  }
  let previous:string|undefined;
  try{const {result}=await mutateStore(s=>{
    const m=s.members.find(m=>m.id===ctx.params.id);if(!m)throw new AppError("成员不存在",404);
    if("name" in b){const name=str(b.name,"",60).trim();assert(name,"姓名不能为空");const old=m.name;m.name=name;s.tasks.filter(t=>t.department===m.department&&t.assignee===old).forEach(t=>t.assignee=name);}
    for(const k of ["role","className","school","phone","preference","note"] as const)if(k in b)m[k]=str(b[k],"",k==="note"?1000:120);
    if(avatar||b.removeAvatar===true||b.removeAvatar==="true"){previous=m.avatar;m.avatar=avatar;}
    return m;
  });if(previous&&previous!==result.avatar&&/^avatar_[\w]+\.webp$/.test(previous)){try{fs.unlinkSync(path.join(dirs.avatars,previous));}catch{}}
  return json({member:result});
  }catch(e){if(avatar)try{fs.unlinkSync(path.join(dirs.avatars,avatar));}catch{}throw e;}
}
export function memberAvatar(ctx:Ctx){
  const member=readStore().members.find(m=>m.id===ctx.params.id);assert(member,"成员不存在",404);
  assert(member.avatar&&/^avatar_[\w]+\.webp$/.test(member.avatar),"该成员尚未设置头像",404);
  const file=path.join(dirs.avatars,member.avatar);assert(fs.existsSync(file),"头像文件不存在，请重新上传",404);
  return new Response(new Uint8Array(fs.readFileSync(file)),{headers:{"content-type":"image/webp","cache-control":"private, no-cache","x-content-type-options":"nosniff"}});
}
export async function reorderMembers(ctx:Ctx){
  const b=await ctx.body<Record<string,unknown>>();
  await mutateStore(s=>{const ids=memberIds(s,b.ids);assert(ids.length>0,"请选择需要排序的成员");const selected=new Set(ids),items=new Map(s.members.map(m=>[m.id,m]));let i=0;s.members=s.members.map(m=>selected.has(m.id)?items.get(ids[i++])!:m);});return json({ok:true});
}
export function listWorkLogs(){return json({workLogs:readStore().workLogs});}
export async function saveWorkLog(ctx:Ctx){
  const b=await ctx.body<Record<string,unknown>>();
  const {result}=await mutateStore(s=>{
    const old=ctx.params.id?s.workLogs.find(w=>w.id===ctx.params.id):undefined;
    if(ctx.params.id&&!old)throw new AppError("出工记录不存在",404);
    const title=str(b.title,"",200).trim(),date=str(b.date,"",10),start=str(b.start,"",5),end=str(b.end,"",5);
    assert(title,"请填写活动名称");assert(isDateLike(date),"请填写有效的出工日期");
    assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(end)&&end>start,"结束时间须晚于开始时间（跨日请分两条记录）");
    const ids=memberIds(s,b.memberIds,"运营部");assert(ids.length>0,"请至少选择一位运营部成员");
    const w:WorkLog={id:old?.id||newId("work"),title,date,start,end,location:str(b.location,"",120),duty:str(b.duty,"摄影",80),memberIds:ids,note:str(b.note,"",1000),status:b.status==="done"?"done":"planned",createdAt:old?.createdAt||nowISO(),updatedAt:nowISO()};
    if(old){if(old.date!==w.date||old.start!==w.start||old.end!==w.end||old.status!==w.status||JSON.stringify(old.memberIds)!==JSON.stringify(w.memberIds)){old.volunteerConfirmed=false;old.volunteerEntered=false;}old.volunteerHours=Object.fromEntries(Object.entries(old.volunteerHours||{}).filter(([id])=>w.memberIds.includes(id)));Object.assign(old,w);}else s.workLogs.push(w);if("volunteerHours" in b)applyVolunteer(old||w,{hours:b.volunteerHours,confirmed:b.volunteerConfirmed,entered:b.volunteerEntered,evidence:b.volunteerEvidence});return old||w;
  });return json({workLog:result});
}
export async function deleteWorkLog(ctx:Ctx){await mutateStore(s=>{const i=s.workLogs.findIndex(w=>w.id===ctx.params.id);assert(i>=0,"出工记录不存在",404);s.workLogs.splice(i,1);});return json({ok:true});}
