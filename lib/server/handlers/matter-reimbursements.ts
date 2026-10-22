import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildActivity } from "../../build";
import { readStore, dirs } from "../../store";
import { shortFileBase,materialFileName } from "../../naming";
import {traditional} from "../../export-traditional";
import { contentDisposition, resolveInside } from "../../files";
import { assert } from "../../errors";
import { toDateStr } from "../../date";
import {buildMatterReimbursementWorkbook,type MatterMaterialRow} from "../../matter-reimbursement-excel";
import type {ReimbActivity} from "../../types";
import type { Ctx } from "../ctx";

const running = new Set<string>();
export async function exportMatter(ctx: Ctx) {
  const store=readStore(), matter=store.matters.find(m=>m.id===ctx.params.id);
  assert(matter,"事务不存在",404);
  const activities=store.activities.filter(a=>a.matterId===matter.id);
  assert(activities.length,"此事务尚未关联报销，请先在报销资料中选择关联事务");
  assert(activities.every(a=>a.department===matter.department),"关联报销的部门与事务不一致，请先核对");
  const incomplete=activities.filter(a=>!a.items.length||!a.files.length);
  assert(!incomplete.length,`以下报销缺少事项或材料，请补齐后整体打包：${incomplete.map(a=>a.name).join("、")}`);
  assert(activities.length<=50&&activities.reduce((s,a)=>s+a.files.reduce((n,f)=>n+f.size,0),0)<=100*1024*1024,"此事务材料超过整包处理上限（50 笔 / 100 MB），请分别打包报销记录");
  assert(!running.has(matter.id),"此事务正在打包，请稍候",409);
  running.add(matter.id);
  try {
    const zip=new JSZip(), top=zip.folder(`${shortFileBase(traditional(matter.title),100)||"事務"}_全部報銷材料`)!;
    const catalog=[`事务：${matter.title}`,`关联报销：${activities.length} 笔`,"按实际报销人分文件夹，材料直接存放；统计统一见根目录的事务报销统计表.xlsx。",""];
    let bytesRead=0, total=0;
    const exported: ReimbActivity[]=[];
    const materials: MatterMaterialRow[]=[];
    const claimantFolders=new Map<string,string>(),usedFolders=new Set<string>();
    const itemOffsets=new Map<string,number>();
    for (const [index,original] of activities.entries()) {
      // Recheck association before each build so a moved record cannot leak into the wrong bundle.
      const current=readStore().activities.find(a=>a.id===original.id);
      assert(current?.matterId===matter.id&&current.department===matter.department,"报销关联在打包期间发生变化，请重新生成",409);
      const {activity,output}=await buildActivity(original.id);
      assert(output.manifest.filter(f=>f.kind!=="合并件").length===activity.files.length,`《${activity.name}》有材料无法处理，请先核对单笔报销后再整体打包`,422);
      exported.push(activity);
      const dir=resolveInside(dirs.exports,path.relative(dirs.exports,path.resolve(dirs.root,output.dir)));
      const packed=await JSZip.loadAsync(fs.readFileSync(resolveInside(dir,output.zipName)));
      const claimant=activity.submitter.trim()||"未填写";
      if(!claimantFolders.has(claimant)){
        const base=`報銷人-${shortFileBase(traditional(claimant),60)}`;let candidate=base,n=2;
        while(usedFolders.has(candidate))candidate=`${base}(${n++})`;
        claimantFolders.set(claimant,candidate);usedFolders.add(candidate);
      }
      const prefix=claimantFolders.get(claimant)!;
      const folder=top.folder(prefix)!;
      const offset=itemOffsets.get(claimant)||0,materialCounts=new Map<number,number>();
      for (const entry of Object.values(packed.files)) {
        if(entry.dir)continue;
        const relative=entry.name.split("/").slice(1).join("/");
        assert(relative&&!relative.split("/").some(p=>p===".."||p==="."),"材料包中存在非法文件名");
        if(relative===output.xlsxName||relative==="材料清單.txt")continue;
        assert(!relative.includes("/"),"单笔材料包中存在多余目录，请重新生成",422);
        const bytes=await entry.async("nodebuffer");bytesRead+=bytes.length;
        assert(bytesRead<=128*1024*1024,"材料转换后超过整包处理上限，请分别导出报销记录",413);
        const material=output.manifest.find(m=>m.name===relative);
        assert(material,"材料清单与压缩包不一致，请重新生成",422);
        const sourceFile=activity.files.find(f=>f.id===material.fileId);
        const itemIndex=activity.items.findIndex(i=>i.id===sourceFile?.itemId);
        const localItem=material.kind==="合并件"?0:itemIndex>=0?itemIndex:activity.items.length;
        const materialIndex=(materialCounts.get(localItem)||0)+1;materialCounts.set(localItem,materialIndex);
        const item=activity.items[localItem];
        const name=materialFileName({seq:`${offset+localItem+1}-${materialIndex}`,item:material.kind==="合并件"?activity.name:item?.name||"未归类",amount:material.kind==="合并件"?output.totalAmount:item?.amount??null,kind:material.kind,extension:relative.toLowerCase().endsWith(".txt")?".txt":".pdf"});
        folder.file(name,bytes);
        const source=material?.originalName||(material?.kind==="合并件"?"由报销材料生成":"");
        materials.push({claimant,activity:activity.name,kind:material?.kind||"其他",path:`${prefix}/${name}`,originalName:source});
      }
      itemOffsets.set(claimant,offset+activity.items.length+(activity.files.some(f=>!activity.items.some(i=>i.id===f.itemId))?1:0));
      total+=output.totalAmount;
      catalog.push(`${index+1}. 报销人：${claimant}；经办人：${activity.handler||"未填写"}；报销：${activity.name}；金额：¥${output.totalAmount.toFixed(2)}`,`   文件夹：${prefix}`,...output.warnings.map(w=>`   待核对：${w}`),"");
    }
    const latest=readStore().activities.filter(a=>a.matterId===matter.id);
    assert(latest.length===exported.length&&latest.every(a=>exported.some(old=>old.id===a.id&&old.updatedAt===a.updatedAt&&a.department===matter.department)),"事务的关联报销已变化，请重新生成",409);
    catalog.push(`合计：¥${total.toFixed(2)}`,`生成时间：${new Date().toISOString()}`);
    top.file("事務報銷清單.txt",catalog.map(traditional).join("\r\n"));
    top.file("事務報銷統計表.xlsx",await buildMatterReimbursementWorkbook(matter,exported,materials));
    const claimants=[...new Set(exported.map(a=>a.submitter.trim()||"未填写"))], joined=claimants.join("、");
    const label=shortFileBase(traditional(joined),60)+(new TextEncoder().encode(traditional(joined)).length>60?`等${claimants.length}人`:"");
    const name=`${shortFileBase(traditional(matter.title),80)}_報銷人-${label}_全部報銷材料_${toDateStr(new Date()).replace(/-/g,"")}.zip`;
    const bytes=await zip.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:6}});
    return new Response(new Uint8Array(bytes),{headers:{"content-type":"application/zip","content-disposition":contentDisposition(name),"cache-control":"no-store","x-workbench-activity-count":String(activities.length)}});
  } finally { running.delete(matter.id); }
}
