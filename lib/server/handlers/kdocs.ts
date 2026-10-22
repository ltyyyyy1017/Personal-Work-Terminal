import {readStore,mutateStore} from "../../store";
import {assert} from "../../errors";
import {json,str} from "../http";
import {kdocsClient,kdocsUrl,kdocsConnected,saveKdocsToken} from "../../kdocs";
import {runKdocs,pendingKdocs} from "../../kdocs-sync";
import {PERFORMANCE_RULES} from "../../performance-rules";
import type {Ctx} from "../ctx";
import type {KdocsMapping} from "../../types";
export function status(){return json({connected:kdocsConnected(),config:readStore().kdocs||null,pending:pendingKdocs()});}
export async function configure(ctx:Ctx){
 const b=await ctx.body<Record<string,unknown>>();if(b.enabled===false){await mutateStore(s=>{if(s.kdocs)s.kdocs.enabled=false;});return status();}
 const current=readStore().kdocs,url=kdocsUrl(b.url||current?.url),year=Number(b.year??current?.year??new Date().getFullYear());assert(Number.isInteger(year)&&year>=2020&&year<=2100,"請填寫有效的起始年份");
 assert(!current||current.url===url||!Object.values(current.publications).some(links=>links.length),"原表仍有工作台回填記錄，請先將相關任務改為僅工作台紀錄並完成同步，再更換連結",409);
 if(b.token!==undefined){const token=str(b.token,"",16000).trim();assert(token.length>15,"請填寫有效的金山文檔授權 Token");await kdocsClient(token).info(url);saveKdocsToken(token);}
 let mappings:KdocsMapping[]|undefined;
 if(b.mappings!==undefined){assert(Array.isArray(b.mappings)&&b.mappings.length<=100,"頁籤欄位設定不正確");mappings=b.mappings.map(raw=>{assert(raw&&typeof raw==="object","頁籤欄位不正確");const v=raw as Record<string,unknown>;assert(Number.isInteger(v.sheetId)&&Number.isInteger(v.headerRow)&&Number(v.headerRow)>=0&&Number(v.headerRow)<100,"頁籤或表頭行無效");const map={sheetId:Number(v.sheetId),headerRow:Number(v.headerRow)} as KdocsMapping;
  for(const key of ["titleColumn","memberColumn","dateColumn","activityColumn","noteColumn","statusColumn","ruleColumn","detailColumn","scoreColumn","categoryColumn"]as const)if(v[key]!==undefined&&v[key]!==null&&v[key]!==""){assert(Number.isInteger(v[key])&&Number(v[key])>=0&&Number(v[key])<100,"欄位編號無效");map[key]=Number(v[key]);}
  assert(map.titleColumn!==undefined&&map.memberColumn!==undefined,"請選擇工作事項與姓名欄");const cols=[map.titleColumn,map.memberColumn,map.dateColumn,map.activityColumn,map.noteColumn,map.statusColumn,map.ruleColumn,map.detailColumn,map.scoreColumn,map.categoryColumn].filter(x=>x!==undefined);assert(new Set(cols).size===cols.length,"不同用途不可使用同一欄位");
  if(v.rule){assert(typeof v.rule==="string"&&Object.hasOwn(PERFORMANCE_RULES,v.rule),"績效項目無效");map.rule=v.rule;}if(v.phase==="pre"||v.phase==="post")map.phase=v.phase;return map;});}
 await mutateStore(s=>{const old=s.kdocs,same=old?.url===url;s.kdocs={...(same?old:undefined),enabled:kdocsConnected(),url,department:"行政部",year,mappings:mappings||(same?old!.mappings:[]),sheets:same?old!.sheets:[],importedCount:same?old!.importedCount:0,performanceCount:same?old!.performanceCount:0,issues:same?old!.issues:[],importHashes:same?old!.importHashes:{},publications:same?old!.publications:{},taskHashes:same?old!.taskHashes:{}};});return status();
}
export async function sync(){await runKdocs("all");return status();}
