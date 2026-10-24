import {Converter} from "opencc-js/cn2t";
import {Converter as SimplifiedConverter} from "opencc-js/t2cn";
import type ExcelJS from "exceljs";

const convert=Converter({from:"cn",to:"hk"});
export const traditional=(value:string)=>convert(value);
const simplify=SimplifiedConverter({from:"hk",to:"cn"});
export const exportText=(value:string,department?:string)=>department==="行政部"?traditional(value):simplify(value);

/** Convert generated text only; numbers, account identifiers and formula objects retain their types. */
export function traditionalWorkbook(workbook:ExcelJS.Workbook){
  exportWorkbook(workbook,"行政部");
}
export function exportWorkbook(workbook:ExcelJS.Workbook,department?:string){
  const text=(value:string)=>exportText(value,department);
  workbook.creator=text(workbook.creator||"");
  for(const sheet of workbook.worksheets){
    sheet.name=text(sheet.name);
    sheet.eachRow(row=>row.eachCell(cell=>{
      if(typeof cell.value==="string")cell.value=text(cell.value);
      else if(cell.value&&typeof cell.value==="object"&&"richText" in cell.value)cell.value={richText:cell.value.richText.map(part=>({...part,text:text(part.text)}))};
    }));
  }
}
