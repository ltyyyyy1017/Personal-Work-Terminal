import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
const folder = path.resolve("runtime/reimbursement-text-check"); await fs.mkdir(folder, { recursive: true });
const modules = ["errors", "invoice", "pdf", "reimbursement-recognition", "plain-text", "material-layout", "pdf-options", "expense-date", "rapid-ocr", "document-material", "material-reader"];
for (const name of modules) {
  let source = await fs.readFile(`lib/${name}.ts`, "utf8");
  for (const dep of modules) source = source.replaceAll(`"./${dep}"`, `"./${dep}.mjs"`);
  await fs.writeFile(path.join(folder, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const {parseMaterialText: parse, summarizeRecognition} = await import(pathToFileURL(path.join(folder,"reimbursement-recognition.mjs")));
const {readMaterial} = await import(pathToFileURL(path.join(folder,"material-reader.mjs")));
const {decodePlainText} = await import(pathToFileURL(path.join(folder,"plain-text.mjs")));
const {invoiceColumnText} = await import(pathToFileURL(path.join(folder,"material-layout.mjs")));
const doc = text => parse(text,{id:"test",name:"材料.txt",fingerprint:"test",method:"plain-text"});
const content = "報銷人：测试乙\n經辦人：测试甲\n同行人員：\n1. 测试丙\n2. 测试丁\n備註：活动交通\n起點：学校南门\n終點：活动会场";
for (const [encoding, bytes] of [["utf8",Buffer.from(content)], ["UTF8-BOM",Buffer.concat([Buffer.from([239,187,191]),Buffer.from(content)])], ["UTF16LE",Buffer.concat([Buffer.from([255,254]),Buffer.from(content,"utf16le")])]]) {
  const result = await readMaterial(bytes,`${encoding}.TXT`,encoding);
  assert.equal(result.method,"plain-text");assert.equal(result.fields.name,"测试乙");assert.equal(result.fields.handler,"测试甲");assert.equal(result.fields.companions,"测试丙、测试丁");assert.equal(result.fields.from,"学校南门");assert.equal(result.fields.to,"活动会场");assert.equal(result.taxi,true);
}
// The bytes for 同行人：张三、李四 in Windows GBK; exercises the GB18030 decoder fallback.
const gbk = Buffer.from('cdacd0d0c8cba3bad5c5c8fda1a2c0eecbc4','hex');
assert.equal(decodePlainText(gbk),'同行人：张三、李四');
assert.equal((await readMaterial(gbk,'GBK.txt','gbk')).fields.companions,'张三、李四');
const be = Buffer.from(content,'utf16le');be.swap16();assert.equal(decodePlainText(Buffer.concat([Buffer.from([254,255]),be])),content);
assert.throws(()=>decodePlainText(Buffer.alloc(1024*1024+1)));assert.throws(()=>decodePlainText(Buffer.from([0,0,1,2,3])));
assert.equal(doc("乘车人姓名：乘客甲\n付款人姓名：付款乙").fields.name,undefined);
assert.equal(doc("报销人收款银行：示例银行\n报销人收款账号：TESTACCOUNT\n报销人联系方式：TESTPHONE").fields.name,undefined);
assert.equal(doc("报销人：\n经办人：测试经办").fields.name,undefined);
assert.equal(doc("同行人：测试甲、测试乙\n报销人：测试丙").fields.companions,"测试甲、测试乙");
assert.equal(doc("同行人：测试甲、测试乙").kind,"同行人");
assert.equal(doc("保管说明：活动材料").kind,"其他");
for (const input of ["上车地点：学校南门  下车地点：活动会场  里程：5公里", "起点\n学校南门\n终点\n活动会场", "起点\n终点\n学校南门\n活动会场", "序号\t车型\t起点\t终点\t金额\n1\t快车\t学校南门\t活动会场\t20.00", "起点  终点\n学校南门  活动会场"]) {
  const result = doc(`滴滴行程单\n${input}`); assert.equal(result.fields.from,"学校南门",input);assert.equal(result.fields.to,"活动会场",input);
}
assert.equal(doc("行程单\n起点  终点\n学校南门  活动会场\n活动会场  学校南门").fields.from,undefined);
const buyer="测试购买单位", seller="测试商家", buyerTax="91110000TEST000001X", sellerTax="91110000TEST000002X";
const cells=[];for(const [x,party,name,tax] of [[30,'购买方',buyer,buyerTax],[330,'销售方',seller,sellerTax]]){
  [...party].forEach((str,i)=>cells.push({str,x,y:700-i*18,height:12}));cells.push({str:`名称：${name}`,x:x+25,y:700,height:12},{str:`统一社会信用代码：${tax}`,x:x+25,y:670,height:12});
}cells.push({str:'项目名称',x:30,y:600,height:12});
assert.ok(invoiceColumnText(cells));assert.equal(doc(`电子发票\n${invoiceColumnText(cells)}`).fields.buyer,buyer);
for (const text of [
  `购买方信息\n名称：${buyer}\n统一社会信用代码：${buyerTax}\n销售方信息\n名称：${seller}\n统一社会信用代码：${sellerTax}`,
  `销售方信息\n名称：${seller}\n统一社会信用代码：${sellerTax}\n购买方信息\n名称：${buyer}\n统一社会信用代码：${buyerTax}`,
  `购买方信息  销售方信息\n名称：${buyer}  名称：${seller}\n统一社会信用代码：${buyerTax}  统一社会信用代码：${sellerTax}`,
  `销售方信息  购买方信息\n名称：${seller}  名称：${buyer}\n统一社会信用代码：${sellerTax}  统一社会信用代码：${buyerTax}`,
  `购买方名称：${buyer}\n购买方税号：${buyerTax}\n销售方名称：${seller}\n销售方税号：${sellerTax}`
]) {
  const result = doc(`电子发票\n${text}\n项目名称\n*运输服务*车费\n价税合计：￥20.00`);
  assert.equal(result.fields.buyer,buyer,text);assert.equal(result.fields.taxId,buyerTax,text);assert.equal(result.meta.sellerName,seller,text);assert.equal(result.meta.sellerTaxId,sellerTax,text);
}
assert.equal(doc(`电子发票\n销售方信息\n名称：${seller}\n统一社会信用代码：${sellerTax}`).fields.buyer,undefined);
assert.equal(doc(`电子发票\n销售方信息\n名称：${seller}\n统一社会信用代码：${sellerTax}`).fields.taxId,undefined);
assert.equal(doc(`电子发票\n购买方信息  销售方信息\n名称：${seller}`).fields.buyer,undefined);
const s = summarizeRecognition([doc(content)]); assert.equal(s.fields.handler.value,"测试甲");assert.equal(s.fields.name.value,"测试乙");
console.log("PASS TXT encodings/companions, distinct claimant and handler, itinerary labels/tables, buyer/seller sections and reversed columns; ambiguous parties are not guessed.");
