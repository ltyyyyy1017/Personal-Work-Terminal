import {Converter} from "opencc-js/cn2t";
import type ExcelJS from "exceljs";

const convert=Converter({from:"cn",to:"hk"});
export const traditional=(value:string)=>convert(value);

/** Convert generated text only; numbers, account identifiers and formula objects retain their types. */
export function traditionalWorkbook(workbook:ExcelJS.Workbook){
  workbook.creator=traditional(workbook.creator||"");
  for(const sheet of workbook.worksheets){
    sheet.name=traditional(sheet.name);
    sheet.eachRow(row=>row.eachCell(cell=>{
      if(typeof cell.value==="string")cell.value=traditional(cell.value);
      else if(cell.value&&typeof cell.value==="object"&&"richText" in cell.value)cell.value={richText:cell.value.richText.map(part=>({...part,text:traditional(part.text)}))};
    }));
  }
}
