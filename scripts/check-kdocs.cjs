const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
process.env.WORKBENCH_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-kdocs-'));process.env.WORKBENCH_SKIP_SYNC='true';
const resolve=Module._resolveFilename;Module._resolveFilename=function(name,...rest){return resolve.call(this,name.startsWith('@/')?path.join(process.cwd(),name.slice(2)):name,...rest);};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=function(m,file){m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);};
const {readStore,mutateStore}=require('../lib/store.ts'),{pullKdocs,pushKdocs,pendingKdocs}=require('../lib/kdocs-sync.ts'),{kdocsUrl,kdocsClient}=require('../lib/kdocs.ts'),{suggestKdocsMapping}=require('../lib/kdocs-data.ts');
const cell=(row,col,value,extra={})=>({rowFrom:row,rowTo:row,colFrom:col,colTo:col,cellText:String(value),...extra});
const rows=values=>values.flatMap((v,r)=>v.map((text,c)=>cell(r,c,text))).filter(c=>c.cellText);
const url='https://www.kdocs.cn/l/exampleDemo123',mapping={sheetId:11,headerRow:0,titleColumn:0,memberColumn:1,dateColumn:2,activityColumn:3,noteColumn:4,statusColumn:5,ruleColumn:6};
class Fake{
 tabs=[{sheet:{sheetId:11,sheetName:'測試活動工作',rowFrom:0,rowTo:12,colFrom:0,colTo:6,isVisible:true,sheetType:'et'},cells:rows([
  ['工作事項','姓名','日期','所屬活動','備註','狀態','考核項目'],
  ['物資準備','測試成員甲','2026-10-21','測試大事項','','已完成','materials'],
  ['活動出席','测试成员乙','2026-10-21','測試大事項','','已完成','internal'],
  ['日期待確認','測試成員甲','','測試大事項','','已完成','internal'],
  ['項目待確認','測試成員甲','2026-10-21','測試大事項','','已完成','未知項目'],
  ['協作者記錄','未列名成員','2026-10-21','測試大事項','','已完成','internal']
 ])}];writes=0;failBefore=false;failAfter=false;
 async info(){return{sheetsInfo:structuredClone(this.tabs.map(t=>t.sheet))};}
 async read(_url,id,rowFrom,rowTo,colFrom,colTo){return{detail:{rangeData:structuredClone(this.tabs.find(t=>t.sheet.sheetId===id).cells.filter(c=>c.rowFrom>=rowFrom&&c.rowFrom<=rowTo&&c.colFrom>=colFrom&&c.colFrom<=colTo))}};}
 async write(_url,id,values){if(this.failBefore){this.failBefore=false;throw Error('request failed before writing');}this.writes++;const t=this.tabs.find(t=>t.sheet.sheetId===id);for(const v of values){const index=t.cells.findIndex(c=>c.rowFrom===v.row&&c.colFrom===v.col);const c=cell(v.row,v.col,v.value);if(index<0)t.cells.push(c);else t.cells[index]=c;t.sheet.rowTo=Math.max(t.sheet.rowTo,v.row);}if(this.failAfter){this.failAfter=false;throw Error('lost response after commit');}}
 value(row,col){return this.tabs[0].cells.find(c=>c.rowFrom===row&&c.colFrom===col)?.cellText||'';}
 set(row,col,value){const t=this.tabs[0],c=t.cells.find(c=>c.rowFrom===row&&c.colFrom===col);if(c)c.cellText=value;else t.cells.push(cell(row,col,value));}
}
(async()=>{
 for(const bad of ['http://www.kdocs.cn/l/exampleDemo123','https://www.kdocs.cn.evil.invalid/l/exampleDemo123','https://127.0.0.1/l/exampleDemo123','https://user:pass@www.kdocs.cn/l/exampleDemo123'])assert.throws(()=>kdocsUrl(bad));assert.equal(kdocsUrl(url+'?tracking=1'),url);
 const fake=new Fake();assert.deepEqual(JSON.parse(JSON.stringify(suggestKdocsMapping(11,fake.tabs[0].cells))),mapping);
 await mutateStore(s=>{s.members=[{id:'m1',name:'測試成員甲',department:'行政部'},{id:'m2',name:'測試成員乙',department:'行政部'}];s.kdocs={enabled:true,url,department:'行政部',year:2026,mappings:[mapping],sheets:[],importedCount:0,performanceCount:0,issues:[],importHashes:{},publications:{},taskHashes:{}};});
 await pullKdocs(fake,readStore().kdocs);let s=readStore();assert.equal(s.tasks.length,4);assert.equal(s.matters.length,1);assert.equal(s.performance.length,1);assert.equal(s.performance[0].memberId,'m2');assert.ok(s.tasks.every(t=>t.status==='done'&&t.sourceRecorded&&!t.reviewRequired));assert.ok(s.kdocs.issues.some(v=>v.includes('缺少明確日期')));assert.ok(s.kdocs.issues.some(v=>v.includes('尚未區分')));assert.ok(!s.tasks.some(t=>t.title==='協作者記錄'));
 const imported=s.tasks.map(t=>t.id);await pullKdocs(fake,s.kdocs);assert.deepEqual(readStore().tasks.map(t=>t.id),imported);assert.equal(readStore().performance.length,1);
 // Row moves preserve identities and manual changes are not overwritten.
 for(const c of fake.tabs[0].cells)if(c.rowFrom>0){c.rowFrom+=1;c.rowTo+=1;}
 fake.tabs[0].sheet.rowTo++;await mutateStore(s=>{s.tasks[0].note='保留本機備註';});await pullKdocs(fake,readStore().kdocs);assert.deepEqual(readStore().tasks.map(t=>t.id),imported);assert.equal(readStore().tasks[0].note,'保留本機備註');assert.equal(readStore().performance.length,1);
 const local={id:'local',title:'工作台新工作',department:'行政部',memberIds:['m1','m2'],status:'done',workDate:'2026-10-22',priority:'normal',createdAt:'2026-10-22',updatedAt:'2026-10-22'};
 await mutateStore(s=>s.tasks.push(local));assert.equal(pendingKdocs(),0);await pushKdocs(fake,readStore().kdocs);assert.equal(fake.writes,0);
 await mutateStore(s=>{s.tasks.find(t=>t.id==='local').kdocsReporting={include:true,sheetId:11};});fake.failBefore=true;await assert.rejects(pushKdocs(fake,readStore().kdocs));let link=readStore().kdocs.publications.local[0];const appendRow=link.row;assert.equal(fake.value(appendRow,0),'');
 await pushKdocs(fake,readStore().kdocs);assert.equal(pendingKdocs(),0);assert.equal(fake.value(appendRow,0),local.title);assert.equal(fake.value(appendRow,1),'測試成員甲、測試成員乙');const writes=fake.writes;await pushKdocs(fake,readStore().kdocs);assert.equal(fake.writes,writes);
 const taskCount=readStore().tasks.length;await pullKdocs(fake,readStore().kdocs);assert.equal(readStore().tasks.length,taskCount);
 // A moved published row is updated in place and not imported as another task.
 for(const c of fake.tabs[0].cells)if(c.rowFrom>=appendRow){c.rowFrom+=2;c.rowTo+=2;}fake.tabs[0].sheet.rowTo+=2;
 await pullKdocs(fake,readStore().kdocs);assert.equal(readStore().tasks.length,taskCount);
 await mutateStore(s=>{s.tasks.find(t=>t.id==='local').title='更新工作';});fake.failAfter=true;await assert.rejects(pushKdocs(fake,readStore().kdocs));await pushKdocs(fake,readStore().kdocs);link=readStore().kdocs.publications.local[0];assert.equal(link.row,appendRow+2);assert.equal(fake.value(link.row,0),'更新工作');assert.equal(pendingKdocs(),0);
 // Human edits and formulas stop writes.
 fake.set(link.row,0,'人工編輯');await mutateStore(s=>{s.tasks.find(t=>t.id==='local').title='新版本';});await assert.rejects(pushKdocs(fake,readStore().kdocs),/人工修改/);assert.equal(fake.value(link.row,0),'人工編輯');fake.set(link.row,0,'更新工作');
 const c=fake.tabs[0].cells.find(c=>c.rowFrom===link.row&&c.colFrom===0);c.fmlaText='=1';await assert.rejects(pushKdocs(fake,readStore().kdocs),/公式/);delete c.fmlaText;await pushKdocs(fake,readStore().kdocs);
 // Private conversion after a failed update restores only our cells, with retry.
 await mutateStore(s=>{s.tasks.find(t=>t.id==='local').title='未成功的新版本';});fake.failBefore=true;await assert.rejects(pushKdocs(fake,readStore().kdocs));await mutateStore(s=>{s.tasks.find(t=>t.id==='local').kdocsReporting.include=false;});fake.failAfter=true;await assert.rejects(pushKdocs(fake,readStore().kdocs));await pushKdocs(fake,readStore().kdocs);assert.equal(pendingKdocs(),0);assert.equal(readStore().kdocs.publications.local,undefined);assert.equal(fake.value(link.row,0),'');
 // Adopt imported rows instead of duplicating them; restore them on opting out.
 const source=readStore().tasks.find(t=>t.title==='活動出席');const originalTitleRow=source.kdocsOrigin.row;await mutateStore(s=>{s.tasks.find(t=>t.id===source.id).kdocsReporting={include:true,sheetId:11};});await pushKdocs(fake,readStore().kdocs);assert.equal(readStore().kdocs.publications[source.id][0].owned,false);assert.equal(fake.tabs[0].cells.filter(c=>c.colFrom===0&&c.cellText==='活動出席').length,1);
 await mutateStore(s=>{s.tasks.find(t=>t.id===source.id).kdocsReporting.include=false;});await pushKdocs(fake,readStore().kdocs);assert.equal(fake.value(originalTitleRow,0),'活動出席');
 // Explicitly disabling a recognized worksheet is preserved on future reads.
 await mutateStore(s=>{s.kdocs.mappings=[];});await pullKdocs(fake,readStore().kdocs);assert.equal(readStore().kdocs.mappings.length,0);
 // Official client only uses the fixed endpoint; authorization never enters state/errors.
 const originalFetch=global.fetch;let sent;global.fetch=async(input,options)=>{sent={input,options};return new Response(JSON.stringify({code:0,data:{sheetsInfo:[]}}),{status:200});};
 await kdocsClient('fixture-kdocs-authorization-only').info(url);assert.equal(sent.input,'https://mcp-center.wps.cn/skill_hub/api/v1/tool');assert.equal(JSON.parse(sent.options.body).tool,'sheet.get_sheets_info');assert.equal(sent.options.redirect,'error');
 global.fetch=async()=>new Response('private upstream error',{status:401});await assert.rejects(kdocsClient('fixture-kdocs-authorization-only').info(url),e=>e.status===502&&!e.message.includes('fixture'));global.fetch=originalFetch;assert.ok(!JSON.stringify(readStore()).includes('fixture-kdocs-authorization-only'));
 const React=require('react'),{renderToStaticMarkup:render}=require('react-dom/server'),Approval=require('../components/kdocs-task-approval.tsx').default;const html=render(React.createElement(Approval,{task:local,onClose:()=>{},onSaved:async()=>{}}));assert.ok(html.includes('僅工作台紀錄'));assert.ok(html.includes('填入行政部工作概覽'));assert.ok(!html.includes('name="hours'));
 console.log('PASS KDocs original-sheet imports, approved tasks, raw performance only, missing data review, stable identities, manual edits, opt-in destinations, moved rows, lost responses, retry/deletion cleanup, source adoption, formula protection and fixed official endpoint');
})().catch(e=>{console.error(e);process.exitCode=1;});
