import ExcelJS from "exceljs";
import type {Matter,ReimbActivity} from "./types";
import {isReported,isFunded} from "./reimbursement-progress";

export interface MatterMaterialRow {claimant:string;activity:string;kind:string;path:string;originalName:string}
const money=(n:number)=>Math.round(n*100)/100;
const amount=(a:ReimbActivity)=>money(a.items.reduce((n,i)=>n+Math.round((i.amount||0)*100),0)/100);

/** One workbook for the whole matter; every person and every expense appears in it. */
export async function buildMatterReimbursementWorkbook(matter:Matter,activities:ReimbActivity[],materials:MatterMaterialRow[]) {
  const wb=new ExcelJS.Workbook();wb.creator="个人工作台";wb.created=new Date();
  function sheet(name:string,headers:string[],widths:number[],hint:string){
    const ws=wb.addWorksheet(name,{views:[{state:"frozen",ySplit:5,showGridLines:false}],pageSetup:{paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0}});
    ws.columns=widths.map(width=>({width}));
    for(const [row,text] of [[1,`${matter.title} · ${name}`],[2,`部门：${matter.department}　报销记录：${activities.length} 笔　实际报销人：${new Set(activities.map(a=>a.submitter.trim()||"未填写")).size} 位`],[3,hint]] as const){
      ws.mergeCells(row,1,row,headers.length);const cell=ws.getCell(row,1);cell.value=text;cell.font={name:"Microsoft YaHei",size:row===1?18:11,bold:row===1,color:{argb:row===1?"FF20354D":"FF586C82"}};cell.alignment={vertical:"middle",wrapText:true};ws.getRow(row).height=row===1?38:30;
    }
    const header=ws.getRow(5);header.values=headers;header.height=30;
    header.eachCell(c=>{c.font={name:"Microsoft YaHei",size:11,bold:true,color:{argb:"FFFFFFFF"}};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF365F84"}};c.alignment={vertical:"middle",wrapText:true};});
    ws.autoFilter={from:{row:5,column:1},to:{row:5,column:headers.length}};ws.pageSetup.printTitlesRow="1:5";
    return ws;
  }
  function add(ws:ExcelJS.Worksheet,values:(string|number|null)[],moneyColumns:number[]=[]){
    const row=ws.addRow(values);row.height=32;
    row.eachCell({includeEmpty:true},(cell,col)=>{cell.font={name:"Microsoft YaHei",size:11};cell.alignment={vertical:"middle",wrapText:true};if(row.number%2===0)cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F5FA"}};if(moneyColumns.includes(col))cell.numFmt='#,##0.00';});
    return row;
  }
  const summary=sheet("事务汇总",["报销人","报销笔数","费用项数","材料份数","报销金额（元）","已上报金额","未上报金额","已批款金额","未批款金额","打车同行人"],[20,13,13,13,19,19,19,19,19,40],"金额均为人民币；附件不重复计入金额。同行人按报销人汇总，每笔行程的对应关系见全部报销明细。");
  const groups=new Map<string,ReimbActivity[]>();
  for(const a of activities){const key=a.submitter.trim()||"未填写";groups.set(key,[...(groups.get(key)||[]),a]);}
  const summaryRows:(string|number)[][]=[];
  for(const [claimant,bills] of groups){
    const total=(filter:(a:ReimbActivity)=>boolean=()=>true)=>money(bills.filter(filter).reduce((n,a)=>n+Math.round(amount(a)*100),0)/100);
    const trips=bills.filter(a=>a.taxi), companions=[...new Set(trips.flatMap(a=>a.taxi!.companions))].join("、");
    const companionLabel=companions+(trips.some(a=>!a.taxi!.companions.length)?`${companions?"；":""}同行人待补充`:"");
    const values=[claimant,bills.length,bills.reduce((n,a)=>n+a.items.length,0),bills.reduce((n,a)=>n+a.files.length,0),total(),total(isReported),total(a=>!isReported(a)),total(isFunded),total(a=>!isFunded(a)),companionLabel];summaryRows.push(values);add(summary,values,[5,6,7,8,9]);
  }
  const totals=["事务合计",...Array.from({length:8},(_,i)=>money(summaryRows.reduce((n,r)=>n+Number(r[i+1]),0))),""];
  const sumRow=add(summary,totals,[5,6,7,8,9]);sumRow.font={name:"Microsoft YaHei",size:11,bold:true};
  const detail=sheet("全部报销明细",["序号","报销人","经办人","费用日期","报销名称","费用事项","类别","报销金额（元）","原币实付","币种","上报状态","批款状态","同行人","起点","终点","说明","核对提示","收款银行","收款账号","联系方式"],[8,18,18,15,26,28,16,20,18,12,14,14,30,28,28,36,28,26,30,24],"每项费用一行；原币实付按报销记录仅列一次，报销合计以人民币金额为准。");
  let index=0;
  for(const a of activities)for(const [i,item] of a.items.entries())add(detail,[++index,a.submitter.trim()||"未填写",a.handler||"",a.date,a.name,item.name,a.category,item.amount,i===0?(a.paidAmount??null):null,a.currency||"CNY",isReported(a)?"已上报":"未上报",isFunded(a)?"已批款":"未批款",a.taxi?(a.taxi.companions.join("、")||"同行人待补充"):"",a.taxi?.from||"",a.taxi?.to||"",item.note||a.reason||a.note||"",[item.amount==null?"金额待补充":"",a.taxi&&!a.taxi.companions.length?"同行人待补充":""].filter(Boolean).join("；"),a.bankName||"",a.bankAccount||"",a.contact||""],[8,9]);
  const detailTotal=add(detail,["事务合计","","","","","","",totals[4]], [8]);detailTotal.font={name:"Microsoft YaHei",size:11,bold:true};
  const catalog=sheet("材料目录",["序号","报销人","报销名称","材料类型","包内位置","原文件名"],[8,20,28,16,90,44],"材料直接放在报销人文件夹中；文件名前缀对应报销记录，避免同名材料互相覆盖。");
  materials.forEach((m,i)=>add(catalog,[i+1,m.claimant,m.activity,m.kind,m.path,m.originalName]));
  const checks=activities.flatMap(a=>(a.output?.warnings||[]).map(w=>[a.submitter.trim()||"未填写",a.name,w]));
  if(checks.length){const ws=sheet("待核对事项",["报销人","报销名称","提示"],[22,36,100],"以下提示汇总自各笔报销的材料检查。请在提交前核对。");checks.forEach(row=>add(ws,row));}
  for(const ws of wb.worksheets){const hasTotal=ws.getCell(ws.rowCount,1).value==="事务合计";ws.autoFilter={from:{row:5,column:1},to:{row:Math.max(5,ws.rowCount-(hasTotal?1:0)),column:ws.columnCount}};}
  return Buffer.from(await wb.xlsx.writeBuffer());
}
