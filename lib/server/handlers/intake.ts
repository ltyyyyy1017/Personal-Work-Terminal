import {supportedMaterial,textMaterial,MATERIAL_FORMAT_LABEL} from "../../reimbursement-formats";
import {assert} from "../../errors";
import {readMaterial} from "../../material-reader";
import {json} from "../http";
import type {Ctx} from "../ctx";
export async function preview(ctx:Ctx){
  const form=await ctx.form(),files=form.getAll("files").filter((f):f is File=>f instanceof File);
  assert(files.length>0&&files.length<=10,"每次识别请选择 1–10 份附件");
  assert(files.every(f=>f.size<=15*1024*1024)&&files.reduce((s,f)=>s+f.size,0)<=25*1024*1024,"每份最多 15 MB，合计最多 25 MB");
  assert(files.every(f=>supportedMaterial(f.name)&&f.size>0),`請上傳非空文件：${MATERIAL_FORMAT_LABEL}`);
  assert(files.every(f=>!textMaterial(f.name)||f.size<=1024*1024),"文字格式最多 1 MB");
  const ids=form.getAll("ids").map(String);
  const results=[];
  for(const [index,file] of files.entries()){
    const id=ids[index]&&/^[\w-]{1,80}$/.test(ids[index])?ids[index]:String(index);
    const result=await readMaterial(Buffer.from(await file.arrayBuffer()),file.name,id);
    results.push({...result,warning:result.warnings.join("；")||undefined});
  }
  return json({results});
}
