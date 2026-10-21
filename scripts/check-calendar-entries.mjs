import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const folder=path.resolve('runtime'),files=[path.join(folder,`calendar-date-${process.pid}.mjs`),path.join(folder,`calendar-entries-${process.pid}.mjs`)];
await fs.mkdir(folder,{recursive:true});
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
try{
 await fs.writeFile(files[0],compile(await fs.readFile('lib/date.ts','utf8')));
 await fs.writeFile(files[1],compile((await fs.readFile('lib/calendar-entries.ts','utf8')).replace('"./date"',JSON.stringify(pathToFileURL(files[0]).href))));
 const {calendarEntries,entryOnDay,entryLabel}=await import(pathToFileURL(files[1]).href);
 const common={createdAt:'',updatedAt:'',department:'行政部'};
 const matters=[{...common,id:'m1',title:'换届大会',note:'',startDate:'2026-10-30',endDate:'2026-11-02'},{...common,id:'m2',title:'未定时间',note:''}];
 const tasks=[{...common,id:'t1',title:'搬运物资',matterId:'m1',status:'done',priority:'normal',due:'2026-10-31'},{...common,id:'t2',title:'尚未排期',matterId:'m1',status:'todo',priority:'normal'}];
 const events=[{id:'event1',title:'月末会议',tags:['行政部'],start:'2026-10-31T23:00',end:'2026-11-01T00:00',source:'ui',createdAt:'',updatedAt:''}];
 const snapshot=JSON.stringify({events,matters,tasks}),entries=calendarEntries(events,matters,tasks);
 assert.equal(entries.length,3);assert.equal(JSON.stringify({events,matters,tasks}),snapshot);
 const m=entries.find(e=>e.entryKind==='matter'),t=entries.find(e=>e.entryKind==='task'),e=entries.find(e=>e.entryKind==='event');
 assert.equal(m.end,'2026-11-03');for(const day of ['2026-10-30','2026-10-31','2026-11-01','2026-11-02'])assert.ok(entryOnDay(m,day));assert.ok(!entryOnDay(m,'2026-11-03'));
 assert.equal(t.recordId,'t1');assert.equal(t.parentTitle,'换届大会');assert.equal(t.completed,true);assert.equal(entryLabel(t),'已通过任务');assert.ok(entryOnDay(t,'2026-10-31'));assert.ok(!entryOnDay(t,'2026-11-01'));
 assert.ok(entryOnDay(e,'2026-10-31'));assert.ok(!entryOnDay(e,'2026-11-01'));
 const moved=calendarEntries([],matters,[{...tasks[0],due:'2026-11-01',status:'todo'}]).find(e=>e.entryKind==='task');assert.equal(moved.start,'2026-11-01');assert.equal(entryLabel(moved),'子任务');
 const oneDay=calendarEntries([],[{...matters[0],startDate:'2026-12-31',endDate:undefined}],[])[0];assert.equal(oneDay.end,'2027-01-01');assert.ok(entryOnDay(oneDay,'2026-12-31'));
 console.log('PASS calendar references, source edits, completed children, undated records and inclusive multi-day matters across month/year boundaries');
}finally{await Promise.all(files.map(f=>fs.rm(f,{force:true})));}
