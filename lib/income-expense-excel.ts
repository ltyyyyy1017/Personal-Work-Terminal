import type ExcelJS from "exceljs";
import type {ReimbActivity,Settings} from "./types";
import {reimbursementExportFormat} from "./reimbursement-export-format";
import {organizationFor} from "./organizations";
import {validExpenseDate} from "./expense-date";

const green="FF548235",pale="FFE2F0D9",line="FF000000",font="Microsoft YaHei";
const border:Partial<ExcelJS.Borders>={left:{style:"thin",color:{argb:line}},right:{style:"thin",color:{argb:line}},top:{style:"thin",color:{argb:line}},bottom:{style:"thin",color:{argb:line}}};

/** Reproduce the supplied two-tier income/expense form, one matter across all claimants. */
export function addIncomeExpenseSheet(wb:ExcelJS.Workbook,opts:{department:string;title:string;activities:ReimbActivity[];settings:Settings}){
  const config=reimbursementExportFormat(opts.settings,opts.department);if(config.format!=="income-expense")return;
  const rows=opts.activities.flatMap(a=>a.items.map(item=>({a,item,date:validExpenseDate(a.date)}))).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
  const ws=wb.addWorksheet("收支明細表",{views:[{showGridLines:false,state:"frozen",ySplit:3}],pageSetup:{paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.2,right:.2,top:.35,bottom:.35,header:.15,footer:.15}}});
  ws.columns=[9.11,13.55,36.64,17.22,31.71,14.19,11,26.93,28].map(width=>({width}));
  const last=Math.max(4,rows.length+3);
  for(let r=1;r<=last;r++)for(let c=1;c<=9;c++){
    const cell=ws.getCell(r,c);cell.font={name:font,size:r===1?20:r===2?16:r===3?12:11,bold:r<3,color:{argb:"FF000000"}};
    cell.border=border;cell.alignment={horizontal:"center",vertical:"middle",wrapText:true};
    if(r===1||r>=4)cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:r===1?green:pale}};
  }
  ws.mergeCells("A1:I1");
  const dates=[...new Set(rows.flatMap(r=>r.date?[r.date]:[]))];
  const range=dates.length?(dates[0]===dates.at(-1)?dates[0]:`${dates[0]} 至 ${dates.at(-1)}`).replace(/-/g,"."):"日期待補充";
  ws.getCell("A1").value=`${config.title?.trim()||`${organizationFor(opts.department,opts.settings)}收支明細表`} - ${range} ${opts.title}`;
  ws.getRow(1).height=48;ws.getRow(2).height=29;ws.getRow(3).height=26;
  for(const area of ["A2:A3","B2:B3","C2:C3","D2:F2","H2:H3","I2:I3"])ws.mergeCells(area);
  for(const [cell,value]of Object.entries({A2:"序號",B2:"日期",C2:"內容",D2:"支出",G2:"收入",H2:"收支後",I2:"備註",D3:"具體名稱",E3:"單價*數量/報銷人",F3:"金額",G3:"金額"}))ws.getCell(cell).value=value;
  if(last>4)for(const col of ["A","C","H"])ws.mergeCells(`${col}4:${col}${last}`);
  ws.getCell("A4").value=rows.length?1:null;ws.getCell("C4").value=opts.title;
  for(const [i,{a,item,date}]of rows.entries()){
    const r=i+4;
    ws.getCell(r,2).value=date?new Date(date+"T12:00:00Z"):null;ws.getCell(r,2).numFmt="yyyy.mm.dd";
    ws.getCell(r,4).value=item.name||a.category;
    const companions=[...new Set((a.taxi?.companions||[]).map(name=>name.trim()).filter(Boolean))].join("，");
    const claimant=`${a.submitter.trim()||"報銷人待補充"}${companions?`（${companions}）`:""}`;
    ws.getCell(r,5).value=claimant;
    ws.getCell(r,6).value=typeof item.amount==="number"&&Number.isFinite(item.amount)?Math.round(item.amount*100)/100:null;
    const notes=[!date?"費用日期待補充":"",a.taxi?`起點：${a.taxi.from||"待補充"}\n終點：${a.taxi.to||"待補充"}`:"",item.note||a.reason||a.note||""].filter(Boolean).join("\n");
    ws.getCell(r,9).value=notes;
    for(const c of [6,7]){ws.getCell(r,c).numFmt="#,##0.00";ws.getCell(r,c).alignment={horizontal:"right",vertical:"middle"};}
    for(const c of [4,5,9])ws.getCell(r,c).alignment={horizontal:"left",vertical:"middle",wrapText:true};
    const lines=Math.max(...[claimant,notes,item.name].map((v,j)=>v.split("\n").reduce((n,t)=>n+Math.max(1,Math.ceil([...t].length/(j===0?18:j===1?16:10))),0)));
    ws.getRow(r).height=Math.min(409.5,Math.max(32,lines*16+10));
  }
  // The supplied form totals expenditure here. Income is deliberately left unrecorded.
  const values=rows.map(r=>r.item.amount),complete=values.every(v=>typeof v==="number"&&Number.isFinite(v));
  if(rows.length)ws.getCell("H4").value={formula:complete?`SUM(F4:F${last})`:`IF(COUNT(F4:F${last})<${rows.length},"待補充",SUM(F4:F${last}))`,result:complete?Math.round(values.reduce<number>((sum,n)=>sum+Math.round((n||0)*100),0))/100:"待補充"};
  ws.getCell("H4").numFmt="#,##0.00";
  for(let start=0;start<rows.length;){let end=start+1;while(end<rows.length&&rows[end].date===rows[start].date)end++;if(end-start>1)ws.mergeCells(`B${start+4}:B${end+3}`);start=end;}
  ws.pageSetup.printArea=`A1:I${last}`;ws.pageSetup.printTitlesRow="1:3";
  return ws;
}
