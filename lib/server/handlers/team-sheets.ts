import {readStore,mutateStore,nowISO} from "../../store";
import {assert} from "../../errors";
import {json,str} from "../http";
import {tencentConnected,tencentClient,tencentAuthCode,saveTencentToken} from "../../tencent-docs";
import {runTeamSheetSync,pendingTeamTasks} from "../../team-sheet-sync";
import type {Ctx} from "../ctx";
import {ownerWorkPlan} from "../../owner-work";
const pending=new Map<string,number>();
export function status(){const s=readStore(),owner=ownerWorkPlan(s);return json({connected:tencentConnected(),config:s.teamSheets||null,pending:pendingTeamTasks(),ownerMemberId:owner.owner?.id,ownerUnrouted:owner.unrouted.map(t=>({id:t.id,title:t.title,matterId:t.matterId}))});}
export async function begin(){for(const [code,until]of pending)if(until<Date.now())pending.delete(code);assert(pending.size<5,"請先完成已開啟的騰訊授權頁");const auth=tencentAuthCode();pending.set(auth.code,Date.now()+15*60_000);return json(auth);}
export async function authorize(ctx:Ctx){const b=await ctx.body<Record<string,unknown>>(),code=str(b.code,"",100);assert(pending.has(code)&&pending.get(code)!>Date.now(),"授權頁已過期，請重新連接");const r=await fetch(`https://docs.qq.com/oauth/v2/mcp/token/get?code=${encodeURIComponent(code)}`,{redirect:"error",signal:AbortSignal.timeout(15000),cache:"no-store"});assert(r.ok,"暫時無法確認騰訊授權",502);const d=await r.json();if(typeof d.data?.token==="string"){saveTencentToken(d.data.token);pending.delete(code);return json({connected:true});}return json({connected:false,pending:d.ret===11510});}
function fileId(value:unknown){let v=str(value,"",300).trim();if(v.startsWith("https://")){const url=new URL(v);assert(url.hostname==="docs.qq.com"&&!url.username&&!url.password,"請填寫騰訊文檔的表格連結");v=url.pathname.match(/^\/sheet\/([\w-]+)\/?$/)?.[1]||"";}assert(/^[\w-]{8,100}$/.test(v),"請填寫有效的騰訊文檔表格連結或編號");return v;}
export async function configure(ctx:Ctx){const b=await ctx.body<Record<string,unknown>>();if(b.enabled===false){await mutateStore(s=>{if(s.teamSheets)s.teamSheets.enabled=false;});return status();}
 const department=str(b.department,"运营部",100),taskFileId=fileId(b.taskFileId),hoursFileId=fileId(b.hoursFileId),academicYear=Number(b.academicYear);assert(department==="运营部","目前先支援运营部的團學表格");assert(taskFileId!==hoursFileId,"任務表與志願時表不可使用同一個文件");assert(Number.isInteger(academicYear)&&academicYear>=2020&&academicYear<=2100,"請填寫學年起始年份");
 const client=await tencentClient();await client.info(taskFileId);await client.info(hoursFileId);
 await mutateStore(s=>{const old=s.teamSheets,same=old?.taskFileId===taskFileId&&old.hoursFileId===hoursFileId;s.teamSheets={...(same?old:undefined),enabled:true,department,taskFileId,hoursFileId,academicYear,enabledAt:same?old!.enabledAt:nowISO(),volunteers:same?old!.volunteers:[],issues:same?old!.issues:[],importedCount:same?old!.importedCount:0,taskHashes:same?old!.taskHashes:{}};});return status();
}
export async function sync(){await runTeamSheetSync("all");return status();}

export async function destinations(){
 const config=readStore().teamSheets;assert(config?.enabled,"請先連接團學表格");const client=await tencentClient();
 const [tasks,hours]=await Promise.all([client.info(config.taskFileId),client.info(config.hoursFileId)]);
 const choices=(sheets:typeof tasks.sheets)=>sheets.filter(s=>s.sheet_type==="worksheet"&&!s.hidden&&!/基准模板|基準模板|工作台同步/.test(s.sheet_name)).map(s=>({id:s.sheet_id,name:s.sheet_name}));
 return json({tasks:choices(tasks.sheets),hours:choices(hours.sheets)});
}
