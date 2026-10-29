import * as localWork from "@/lib/server/handlers/local-work";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { authRequired, setPassword } from "@/lib/auth";
import { sessionValid } from "@/lib/server/authz";
import { json, errorResponse } from "@/lib/server/http";
import { readStore, mutateStore, nowISO, newId, storageInfo } from "@/lib/store";
import { addDays, todayStr } from "@/lib/date";
import type { Ctx } from "@/lib/server/ctx";
import type { Task } from "@/lib/types";
import * as core from "@/lib/server/handlers/core";
import * as calendar from "@/lib/server/handlers/calendar";
import * as reimburse from "@/lib/server/handlers/reimburse";
import {bulk as reimbursementBulk} from "@/lib/server/handlers/reimbursement-bulk";
import { exportMatter } from "@/lib/server/handlers/matter-reimbursements";
import * as docs from "@/lib/server/handlers/docs";
import * as workspace from "@/lib/server/handlers/workspace";
import * as equipment from "@/lib/server/handlers/equipment";
import * as intake from "@/lib/server/handlers/intake";
import * as people from "@/lib/server/handlers/people";
import * as assistant from "@/lib/server/handlers/assistant";
import * as projects from "@/lib/server/handlers/projects";
import * as icloud from "@/lib/server/handlers/icloud";
import * as structure from "@/lib/server/handlers/structure";
import * as records from "@/lib/server/handlers/records";
import * as account from "@/lib/server/handlers/account";
import * as passkeys from "@/lib/server/handlers/passkeys";
import { boundedBody, limitSource } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(req: NextRequest, context: { params: Promise<{path: string[]}> }) {
  try {
    if (process.env.WORKBENCH_PASSWORD && !authRequired() && (process.env.WORKBENCH_LOCK_SETUP!=="true"||process.env.WORKBENCH_USERNAME)) setPassword(process.env.WORKBENCH_PASSWORD, process.env.WORKBENCH_USERNAME);
    if (process.env.WORKBENCH_LOCK_SETUP === "true" && !authRequired()) return json({error:"账号文件缺失，服务已锁定，请管理员从备份恢复"},503);
    const {path} = await context.params;
    const method = req.method;
    const key = path.join("/");
    const ctx: Ctx = { req, url: new URL(req.url), path, params: {id:path[1],itemId:path[3],fileId:path[3]}, body: async <T,>() => {const bytes=await boundedBody(req,512*1024);try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value as T;}catch{throw new AppError("请求 JSON 格式不正确",400);}}, form: async () => {const bytes=await boundedBody(req,key.includes("avatar")?6*1024*1024:key==="reimbursement/preview"?26*1024*1024:50*1024*1024);try{return await new Request(req.url,{method:"POST",headers:{"content-type":req.headers.get("content-type")||""},body:bytes}).formData();}catch{throw new AppError("上传表单格式不正确",400);}} };
    if (!["GET", "HEAD"].includes(method)) {
      const origin = req.headers.get("origin");
      if (origin) {try{const parsed=new URL(origin);if(!["http:","https:"].includes(parsed.protocol)||parsed.host!==req.headers.get("host")||parsed.username||parsed.password)return json({error:"请求来源不匹配"},403);}catch{return json({error:"请求来源不匹配"},403);}}
      if(req.headers.get("sec-fetch-site")==="cross-site")return json({error:"请求来源不匹配"},403);
    }
    if(key.startsWith("auth/")) limitSource(req,"auth-requests",100,60_000);
    if (key === "auth/status" && method === "GET") return account.authStatus(req);
    if (key === "auth/setup" && method === "POST") return await account.setup(ctx);
    if (key === "auth/login" && method === "POST") return await account.login(ctx);
    if (key === "auth/qr/info" && method === "GET") return account.qrInfo(ctx);
    if (key === "auth/qr/new" && method === "POST") return await account.qrNew(ctx);
    if (key === "auth/qr/inspect" && method === "POST") return await account.qrInspect(ctx);
    if (key === "auth/qr/status" && method === "POST") return await account.qrPoll(ctx);
    if (key === "auth/passkeys/status" && method === "GET") return passkeys.status(ctx);
    if (key === "auth/passkeys/login/options" && method === "POST") return await passkeys.authenticationOptions(ctx);
    if (key === "auth/passkeys/login/verify" && method === "POST") return await passkeys.authenticationVerify(ctx);
    if (!sessionValid(req)) return json({error:"请先登录工作台"},401);
    if(key==="workspace/credential/authorize"&&method==="POST")return await workspace.authorizeCredential(ctx);
    if(key==="backup"&&req.headers.get("sec-fetch-site")==="cross-site")return json({error:"请从工作台内发起备份"},403);
    if (key === "auth/logout" && method === "POST") return account.logout(ctx);
    if (key === "auth/password" && method === "POST") return await account.changePassword(ctx);
    if (key === "auth/account" && method === "GET") return account.account(ctx);
    if (key === "auth/devices/revoke" && method === "POST") return await account.revoke(ctx);
    if (key === "auth/qr/approve" && method === "POST") return await account.qrApprove(ctx);
    if (key === "auth/passkeys" && method === "GET") return passkeys.list(ctx);
    if (key === "auth/passkeys/register/options" && method === "POST") return await passkeys.registrationOptions(ctx);
    if (key === "auth/passkeys/register/verify" && method === "POST") return await passkeys.registrationVerify(ctx);
    if (key === "auth/passkeys/remove" && method === "POST") return await passkeys.remove(ctx);
    if(path[0]==="team-sheets"||path[0]==="kdocs")return json({error:"表格連接模組已移除，請使用本地工作紀錄"},410);
    if(key==="work-records/history"&&method==="GET")return localWork.history(ctx);
    if(key==="work-records/restore"&&method==="POST")return await localWork.restore(ctx);
    if(key==="work-records"&&method==="GET")return localWork.list();
    if(key==="work-records/batch"&&method==="POST")return await localWork.batch(ctx);
    if(key==="work-records"&&method==="POST"){ctx.params.id="";return await localWork.save(ctx);}
    if(path[0]==="work-records"&&path.length===2&&method==="PATCH")return await localWork.save(ctx);
    if(path[0]==="work-records"&&path.length===2&&method==="DELETE")return await localWork.remove(ctx);
    if (key === "state" && method === "GET") {
      const s = readStore();
      return json({localWorkRecords:s.localWorkRecords,matters:s.matters,tasks:s.tasks.filter(t=>!t.sourceMissing),members:s.members,workLogs:s.workLogs,resources:workspace.resourceViews(),events:s.events,activities:s.activities,docs:s.docs,settings:s.settings,log:s.log.slice(0,8),system:{...storageInfo(),authRequired:authRequired()},demo:s.tasks.some(t=>t.demo)||s.events.some(e=>e.demo)});
    }
    if(key==="workspace/departments"&&method==="GET")return structure.departments();
    if(key==="workspace/departments"&&method==="POST"){ctx.params.id="";return await structure.saveDepartment(ctx);}
    if(path[0]==="workspace"&&path[1]==="departments"&&path.length===3&&method==="PATCH"){ctx.params.id=path[2];return await structure.saveDepartment(ctx);}
    if(key==="matters"&&method==="POST"){ctx.params.id="";return await structure.saveMatter(ctx);}
    if(key==="matters"&&method==="GET")return json({matters:readStore().matters});
    if(path[0]==="matters"&&path.length===4&&path[2]==="reimbursements"&&path[3]==="export"&&method==="POST")return await exportMatter(ctx);
    if(path[0]==="matters"&&path.length===2&&method==="PATCH")return await structure.saveMatter(ctx);
    if(path[0]==="matters"&&path.length===2&&method==="DELETE")return await structure.deleteMatter(ctx);
    if(key==="members/order"&&method==="PATCH")return await people.reorderMembers(ctx);
    if(key==="performance"&&method==="GET")return records.performance();
    if(key==="performance"&&method==="POST")return await records.createPerformance(ctx);
    if(path[0]==="performance"&&path.length===2&&method==="DELETE")return await records.deletePerformance(ctx);
    if(path[0]==="work-logs"&&path.length===3&&path[2]==="volunteer"&&method==="PATCH")return await records.volunteer(ctx);
    if(key==="icloud"&&method==="GET")return icloud.status();
    if(key==="icloud"&&method==="POST")return await icloud.connect(ctx);
    if(key==="icloud"&&method==="DELETE")return await icloud.disconnect();
    if(key==="icloud/calendars"&&method==="POST")return await icloud.refreshCalendars();
    if(key==="icloud/pull"&&method==="POST")return await icloud.pull(ctx);
    if(key==="icloud/push"&&method==="POST")return await icloud.push(ctx);
    if(path[0]==="members"&&path.length===3&&path[2]==="avatar"&&method==="GET")return people.memberAvatar(ctx);
    if(path[0]==="members"&&path.length===2&&method==="PATCH")return await people.patchMember(ctx);
    if(key==="work-logs"&&method==="GET")return people.listWorkLogs();
    if(key==="work-logs"&&method==="POST"){ctx.params.id="";return await people.saveWorkLog(ctx);}
    if(path[0]==="work-logs"&&path.length===2&&method==="PATCH")return await people.saveWorkLog(ctx);
    if(path[0]==="work-logs"&&path.length===2&&method==="DELETE")return await people.deleteWorkLog(ctx);
    if(key==="assistant/status"&&method==="GET")return assistant.assistantStatus();
    if(key==="assistant/config"&&method==="POST")return await assistant.configure(ctx);
    if(key==="assistant/draft"&&method==="POST")return await assistant.draft(ctx);
    if(key==="github"&&method==="GET")return projects.githubStatus();
    if(key==="github/token"&&method==="POST")return await projects.saveToken(ctx);
    if(key==="github/token"&&method==="DELETE")return await projects.removeToken();
    if(key==="github/sync"&&method==="POST")return await projects.syncGithub(ctx);
    if(key==="events"&&method==="GET")return calendar.listEvents(ctx);
    if(key==="tasks"&&method==="GET")return calendar.listTasks();
    if (key === "workspace/import" && method === "POST") return await workspace.importWorkspace(ctx);
    if (key === "workspace/credential" && method === "POST") return await workspace.credential(ctx);
    if(key==="workspace/login-launch"&&method==="POST")return await workspace.loginLaunch(ctx);
    if(key==="browser-helper"&&method==="GET")return await workspace.browserHelper();
    if(key==="equipment"&&method==="GET")return await equipment.snapshot();
    if(key==="equipment/borrowed"&&method==="GET")return await equipment.borrowed();
    if(path[0]==="equipment"&&path[1]==="devices"&&path.length===3&&method==="PATCH"){ctx.params.id=path[2];return await equipment.patchDevice(ctx);}
    if(path[0]==="equipment"&&path[1]==="status"&&path.length===3&&method==="PATCH"){ctx.params.id=path[2];return await equipment.operationalStatus(ctx);}
    if(key==="reimbursement/preview"&&method==="POST")return await intake.preview(ctx);
    if(key==="reimbursements/bulk"&&method==="POST")return await reimbursementBulk(ctx);
    if (key === "settings" && method === "PATCH") return await core.patchSettings(ctx);
    if (key === "backup" && method === "GET") return await core.backup();
    if (key === "demo" && method === "POST") {
      await mutateStore(s=>{
        if (s.tasks.some(t=>t.demo)||s.events.some(e=>e.demo)) return;
        const now=nowISO(), today=todayStr();
        const samples: Partial<Task>[] = [
          {title:"确认活动相机与镜头交接",assignee:"部员 A",department:"运营部",status:"doing",priority:"high",due:today,followUp:today,kind:"device",activityName:"校园活动",note:"已沟通领用时间，等待确认随附电池和存储卡。此条为演示记录。"},
          {title:"收集各组本周设备使用需求",assignee:"部员 B",department:"运营部",status:"doing",priority:"normal",due:addDays(today,1),followUp:today,kind:"task",note:"确认使用日期、设备数量和现场负责人。"},
          {title:"核对活动物料报销材料",assignee:"自己",department:"行政部",status:"review",priority:"normal",due:addDays(today,2),kind:"task",note:"检查发票、支付记录与采购清单是否一致。"},
          {title:"安排设备归还后的检查",assignee:"部员 C",department:"运营部",status:"doing",priority:"normal",due:addDays(today,1),kind:"device",note:"检查机身、镜头和配件，实际借还记录请以设备网站为准。"},
          {title:"整理部门交接说明",assignee:"自己",department:"个人",status:"done",priority:"low",due:today,kind:"task"},
        ];
        for(const t of samples) s.tasks.push({...t,id:newId("task"),demo:true,createdAt:now,updatedAt:now} as Task);
        for(const e of [{title:"设备领用与现场交接",start:`${today}T14:30`,end:`${today}T15:00`,location:"器材室",tags:["运营部"]},{title:"部门工作碰头",start:`${today}T19:00`,end:`${today}T19:30`,location:"线上",tags:["运营部","会议"]},{title:"活动材料核对",start:`${addDays(today,1)}T16:00`,end:`${addDays(today,1)}T17:00`,location:"办公室",tags:["行政部"]}]) s.events.push({...e,id:newId("evt"),source:"import",demo:true,createdAt:now,updatedAt:now});
      }); return json({ok:true});
    }
    if (key === "demo" && method === "DELETE") { await mutateStore(s=>{s.tasks=s.tasks.filter(t=>!t.demo);s.events=s.events.filter(e=>!e.demo);}); return json({ok:true}); }
    if (path[0] === "tasks") {
      if(path.length===1 && method==="POST") return await calendar.createTask(ctx);
      if(path.length===2 && method==="PATCH") return await calendar.patchTask(ctx);
      if(path.length===2 && method==="DELETE") return await calendar.deleteTask(ctx);
    }
    if (path[0] === "events") {
      if(path.length===1 && method==="POST") return await calendar.createEvent(ctx);
      if(path.length===2 && method==="PATCH") return await calendar.patchEvent(ctx);
      if(path.length===2 && method==="DELETE") return await calendar.deleteEvent(ctx);
    }
    if (path[0] === "activities") {
      if(path.length===1 && method==="POST") return await reimburse.createActivity(ctx);
      if(path.length===2 && method==="GET") return await reimburse.getActivity(ctx);
      if(path.length===2 && method==="PATCH") return await reimburse.patchActivity(ctx);
      if(path.length===2 && method==="DELETE") return await reimburse.deleteActivity(ctx);
      if(path[2]==="recognize" && path.length===3 && method==="POST")return await reimburse.recognizeFile(ctx);
      if(path[2]==="items" && path.length===3 && method==="POST") return await reimburse.addItem(ctx);
      if(path[2]==="items" && path.length===4 && method==="PATCH") return await reimburse.patchItem(ctx);
      if(path[2]==="items" && path.length===4 && method==="DELETE") return await reimburse.deleteItem(ctx);
      if(path[2]==="files" && path.length===3 && method==="POST") return await reimburse.uploadFiles(ctx);
      if(path[2]==="files" && path.length===4 && method==="PATCH") return await reimburse.patchFile(ctx);
      if(path[2]==="files" && path.length===4 && method==="DELETE") return await reimburse.deleteFile(ctx);
      if(path[2]==="build" && method==="POST") return await reimburse.build(ctx);
      if(path[2]==="download" && method==="GET") return await reimburse.download(ctx);
    }
    if(path[0]==="docs") {
      if(path.length===1 && method==="POST") return await docs.uploadDocs(ctx);
      if(path.length===2 && method==="PATCH") return await docs.patchDoc(ctx);
      if(path.length===2 && method==="DELETE") return await docs.deleteDoc(ctx);
      if(path[2]==="download" && method==="GET") return await docs.downloadDoc(ctx);
    }
    return json({error:"接口不存在"},404);
  } catch(err) { return errorResponse(err); }
}
export {route as GET,route as POST,route as PATCH,route as DELETE};
