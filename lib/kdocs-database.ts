import {Converter} from "opencc-js/cn2t";
import {assert} from "./errors";
import type {KdocsCell,KdocsSheet} from "./kdocs";
interface Field {id:string;name:string;type:string;linkSheet?:number;fieldValueEditable?:boolean;autoMode?:boolean;items?:{value:string}[]}
interface Table {id:number;name:string;fields:Field[];primaryFieldId?:string;primary_field_id?:string;recordsCount?:number;records_count?:number}
interface RecordValue {id:string;fields:Record<string,unknown>}
type Call=<T>(tool:string,args:unknown)=>Promise<T>;
const traditional=Converter({from:"cn",to:"hk"});
const key=(s:string)=>traditional(s).normalize("NFKC").replace(/\s+/g,"").replace(/恆/g,"恒");
function text(value:unknown):string {if(value==null)return "";if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return String(value);if(Array.isArray(value))return value.map(text).filter(Boolean).join("、");const v=value as Record<string,unknown>;return typeof v.text==="string"?v.text:text(v.value??(v.linkInfo&&((v.linkInfo as Record<string,unknown>).data)));}
export function kdocsDatabase(call:Call){
 let tables:Table[]=[];const cache=new Map<number,RecordValue[]>();
 async function schema(url:string){const d=await call<{detail:{sheets:Table[]}}>("dbsheet.get_schema",{url,show_very_hidden:false});assert(Array.isArray(d.detail?.sheets),"金山多維表格沒有返回結構",502);tables=d.detail.sheets.filter(s=>Number.isInteger(s.id)&&Array.isArray(s.fields));return tables;}
 async function records(url:string,id:number){const values:RecordValue[]=[],cursors=new Set<string>();let offset="";do{const d=await call<{detail:{records:RecordValue[];offset?:string}}>("dbsheet.list_records",{url,sheet_id:id,page_size:500,offset,prefer_id:true,text_value:"compound",link_value:"all"});assert(Array.isArray(d.detail?.records),"金山多維表格記錄格式無法辨識",502);values.push(...d.detail.records);assert(values.length<=5000,"多維表格超出同步上限（5000 筆）");offset=d.detail.offset||"";assert(!offset||!cursors.has(offset),"多維表格分頁游標重複，已停止讀取",502);cursors.add(offset);}while(offset);assert(new Set(values.map(v=>v.id)).size===values.length,"多維表格返回重複記錄 ID",502);cache.set(id,values);return values;}
 function cells(table:Table,values:RecordValue[]){const result:KdocsCell[]=table.fields.map((f,col)=>({rowFrom:0,rowTo:0,colFrom:col,colTo:col,cellText:f.name}));values.forEach((r,index)=>table.fields.forEach((f,col)=>{let value=text(r.fields[f.id]??r.fields[f.name]);if(f.type==="Date")value=value.replace(/\//g,"-");result.push({rowFrom:index+1,rowTo:index+1,colFrom:col,colTo:col,cellText:value,recordId:r.id,originalCellValue:r.fields[f.id]??r.fields[f.name],...(["Formula","Lookup","Rollup","AutoNumber","CreatedTime","ModifiedTime"].includes(f.type)||f.fieldValueEditable===false?{fmlaText:"[read-only]"}:{})});}));return result;}
 return{
  async info(url:string){await schema(url);cache.clear();return{sheetsInfo:tables.map(t=>({sheetId:t.id,sheetName:t.name,rowFrom:0,rowTo:t.recordsCount??t.records_count??5000,colFrom:0,colTo:t.fields.length-1,isVisible:true,sheetType:"db",links:t.fields.flatMap((f,col)=>{const target=tables.find(s=>s.id===f.linkSheet);return target?[{col,sheetId:target.id,primaryColumn:Math.max(0,target.fields.findIndex(v=>v.id===(target.primaryFieldId||target.primary_field_id)))}]:[];})} as KdocsSheet))};},
  async read(url:string,id:number,rowFrom:number,rowTo:number,colFrom:number,colTo:number){if(!tables.length)await schema(url);const table=tables.find(t=>t.id===id);assert(table,"多維表格資料表已不存在",409);return{detail:{rangeData:cells(table,rowFrom!==rowTo&&cache.has(id)?cache.get(id)!:await records(url,id)).filter(c=>c.rowFrom>=rowFrom&&c.rowFrom<=rowTo&&c.colFrom>=colFrom&&c.colFrom<=colTo)}};},
  async write(url:string,id:number,values:{row:number;col:number;value:string|number}[]){
   const table=tables.find(t=>t.id===id);assert(table,"多維表格資料表已不存在",409);assert(values.length&&new Set(values.map(v=>v.row)).size===1,"多維表格一次只回填一筆記錄");const row=values[0].row;assert(row>0,"不可覆寫多維表格欄位名稱");const prior=cache.get(id)?.[row-1],fields:Record<string,unknown>={};
   for(const v of values){const f=table.fields[v.col];assert(f&&f.fieldValueEditable!==false&&!f.autoMode,"目標欄位為唯讀，已停止回填",409);const value=String(v.value);
    if(["MultiLineText","Text","SingleLineText"].includes(f.type))fields[f.id]=value;
    else if(f.type==="Date"){assert(!value||/^\d{4}-\d{2}-\d{2}$/.test(value),"日期欄需使用有效的年月日");fields[f.id]=value.replace(/-/g,"/");}
    else if(f.type==="SingleSelect"){assert(!value||f.items?.some(i=>i.value===value),"原表沒有這個狀態選項，已停止回填，沒有新增選項",409);fields[f.id]=value;}
    else if(f.type==="Link"||f.type==="OneWayLink"){
     const target=tables.find(t=>t.id===f.linkSheet);assert(target,"原表關聯資料表已移除",409);const targetRows=await records(url,target.id),primary=target.primaryFieldId||target.primary_field_id||target.fields[0]?.id;
     const match=(name:string)=>targetRows.filter(r=>key(text(r.fields[primary]))===key(name));const names=!value?[]:match(value).length===1?[value]:value.split(/[、,，;；\n]+/).map(n=>n.trim()).filter(Boolean);
     fields[f.id]=names.map(name=>{const found=match(name);assert(found.length===1,"原表找不到唯一對應的關聯成員或項目，請先在原表確認，沒有自動新增",409);return found[0].id;});
    }else assert(false,"目標欄位類型暫不支援安全回填，已保留原表",409);
   }
   return call(prior?"dbsheet.update_records":"dbsheet.create_records",{url,sheet_id:id,prefer_id:true,add_select_item:false,records:[{...(prior?{id:prior.id}:{}),fields}]});
  }
 };
}
