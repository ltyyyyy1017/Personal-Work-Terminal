import JSZip from "jszip";
import ExcelJS from "exceljs";
import WordExtractor from "word-extractor";
import {XMLParser} from "fast-xml-parser";
import {decodePlainText} from "./plain-text";
import {layoutLines,type TextCell} from "./material-layout";

const labels:Record<string,string>={InvoiceNumber:"发票号码",InvoiceNo:"发票号码",BuyerName:"购买方名称",PurchaserName:"购买方名称",BuyerTaxID:"购买方税号",BuyerTaxId:"购买方税号",BuyerTaxNo:"购买方税号",PurchaserTaxNumber:"购买方税号",SellerName:"销售方名称",SellerTaxID:"销售方税号",SellerTaxNo:"销售方税号",TotalAmountWithTax:"价税合计",AmountWithTax:"价税合计",TotalTaxIncludedAmount:"价税合计",IssueDate:"开票日期",InvoiceDate:"开票日期",ItemName:"项目名称",GoodsName:"项目名称",ExpenseDate:"费用日期",TravelDate:"行程日期",Departure:"起点",Destination:"终点",Companions:"同行人"};
function xmlObject(raw:string){if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw new Error("XML 不支援外部實體或 DTD");return new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false,parseTagValue:false,trimValues:true}).parse(raw);}
function flatten(value:unknown,key="",rows:string[]=[]):string[]{
  if(Array.isArray(value)){value.forEach(v=>flatten(v,key,rows));return rows;}
  if(value&&typeof value==="object"){for(const [k,v] of Object.entries(value))if(!k.startsWith("@_")){const scoped=/^(Buyer|Purchaser|Seller)$/i.test(key)&&/^(Name|TaxID|TaxNo)$/i.test(k)?key+k:k;flatten(v,k==="#text"?key:scoped,rows);}return rows;}
  if(value!==undefined&&value!==null&&String(value).trim())rows.push(`${labels[key]||key}：${String(value)}`);
  return rows;
}
function csvText(raw:string){
 const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell="";}else cell+=c;}
 if(quoted)throw new Error("CSV 引號未完整結束");if(cell||row.length){row.push(cell);rows.push(row);}
 if(rows.length>10000||rows.some(r=>r.length>80))throw new Error("CSV 超出 10000 列或 80 欄識別限制");
 return rows.map(r=>r.join("\t")).join("\n");
}
async function safeZip(bytes:Buffer){
  const zip=await JSZip.loadAsync(bytes);const entries=Object.values(zip.files);if(entries.length>5000)throw new Error("文件內部項目過多");
  let total=0;
  for(const e of entries){const size=(e as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize||0;total+=size;if(size>12*1024*1024||total>40*1024*1024)throw new Error("文件解壓後超出識別限制");}
  return zip;
}
export async function readDocumentMaterial(bytes:Buffer,name:string):Promise<{text:string;cells?:TextCell[]}> {
  if(/\.(txt|md)$/i.test(name))return {text:decodePlainText(bytes)};
  if(/\.csv$/i.test(name))return {text:csvText(decodePlainText(bytes))};
  if(/\.json$/i.test(name))return {text:flatten(JSON.parse(decodePlainText(bytes))).join("\n")};
  if(/\.xml$/i.test(name))return {text:flatten(xmlObject(decodePlainText(bytes))).join("\n")};
  if(/\.ofd$/i.test(name)){
    const zip=await safeZip(bytes),cells:TextCell[]=[];
    for(const entry of Object.values(zip.files).filter(f=>/Pages\/Page_\d+\/Content\.xml$/i.test(f.name)).slice(0,20)){
      const object=xmlObject(await entry.async("string"));
      const walk=(node:unknown)=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=="object")return;const n=node as Record<string,unknown>;
        if(n.TextCode&&n['@_Boundary']){const b=String(n['@_Boundary']).split(/\s+/).map(Number);const code=Array.isArray(n.TextCode)?n.TextCode:[n.TextCode];for(const c of code){const value=typeof c==="string"?c:String((c as Record<string,unknown>)['#text']||"");if(value)cells.push({str:value,x:b[0],y:-b[1],width:b[2],height:b[3]});}}
        for(const [k,v] of Object.entries(n))if(!k.startsWith('@_')&&k!=="TextCode")walk(v);
      };walk(object);
    }
    const text=cells.length?layoutLines(cells):flatten(xmlObject(await zip.file(/Invoice.*\.xml$/i)[0]?.async('string')||"<empty/>" )).join("\n");
    return {text,cells};
  }
  if(/\.xlsx$/i.test(name)){
    await safeZip(bytes);const wb=new ExcelJS.Workbook();await wb.xlsx.load(new Uint8Array(bytes).buffer);const rows:string[]=[];let count=0;
    for(const ws of wb.worksheets.slice(0,20)){rows.push(ws.name);ws.eachRow(row=>{if(++count>10000)throw new Error("Excel 超過 10000 列識別限制");rows.push(row.values instanceof Array?row.values.slice(1,81).map(v=>v instanceof Date?v.toISOString().slice(0,10):v&&typeof v==='object'?'text' in v?v.text:'result' in v?v.result:JSON.stringify(v):v??"").join("\t"):"");});}
    return {text:rows.join("\n")};
  }
  if(/\.docx?$/i.test(name)){if(/\.docx$/i.test(name))await safeZip(bytes);const doc=await new WordExtractor().extract(bytes);const text=[doc.getBody(),doc.getHeaders(),doc.getFootnotes()].filter(Boolean).join("\n");if(text.length>500_000)throw new Error("Word 文字超出識別限制");return {text};}
  throw new Error("此文件需要額外的讀取引擎");
}
