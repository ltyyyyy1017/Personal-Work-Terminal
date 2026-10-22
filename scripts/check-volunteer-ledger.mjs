import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import ts from 'typescript';
const folder=path.resolve('runtime/volunteer-ledger-check');await fs.mkdir(folder,{recursive:true});
for(const name of ['volunteer-ledger','task-followup','task-reporting']){let s=await fs.readFile(`lib/${name}.ts`,'utf8');s=s.replace('"./task-followup"','"./task-followup.mjs"').replace('"./task-reporting"','"./task-reporting.mjs"');await fs.writeFile(path.join(folder,name+'.mjs'),ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
const {volunteerLedger:ledger}=await import(pathToFileURL(path.join(folder,'volunteer-ledger.mjs')));
const task={id:'t1',title:'测试活动摄影',department:'运营部',status:'done',approvedAt:'2026-10-20T08:00:00.000Z',memberIds:['m1','m2'],volunteerHours:{m1:2,m2:1.5}};
const work={id:'w1',title:task.title,date:'2026-10-20',status:'done',memberIds:['m1'],volunteerHours:{m1:2},volunteerConfirmed:true};
assert.equal(ledger([task],[]).total,3.5);assert.equal(ledger([task],[work]).total,3.5);assert.equal(ledger([task],[work]).duplicates,1);
const conflict=ledger([task],[{...work,volunteerHours:{m1:3}}]);assert.equal(conflict.total,1.5);assert.equal(conflict.conflicts.length,1);assert.deepEqual(conflict.conflicts[0].hours,[2,3]);
assert.equal(ledger([task],[{...work,volunteerConfirmed:false}]).total,3.5);
assert.equal(ledger([task,{...task,id:'t2'}],[]).total,7);
assert.equal(ledger([task],[{...work,title:'另一项工作'}]).total,5.5);
assert.equal(ledger([task],[{...work,title:'另一項顯示名稱',date:'2026-09-30',taskId:'t1'}],'2026-09').total,2);
assert.equal(ledger([task],[{...work,title:'另一項顯示名稱',date:'2026-09-30',taskId:'t1'}],'2026-10').total,1.5);
const sourceTask={...task,sourceRefs:['remote:row:1']},sourceWork={...work,title:'表内标题',sourceRefs:['remote:row:1'],volunteerEntered:true};
const first=ledger([sourceTask],[sourceWork]),second=ledger([sourceTask],[sourceWork]);assert.equal(first.total,3.5);assert.deepEqual(first,second);assert.equal(first.entries.find(e=>e.memberId==='m1').entered,true);
assert.equal(ledger([{...task,department:'其他部门'}],[]).total,0);assert.equal(ledger([{...task,status:'review'}],[]).total,0);
assert.equal(ledger([{...task,memberIds:['m1'],volunteerHours:{m1:0}}],[]).entries[0].hours,0);
console.log('PASS per-person ledger: explicit/source links, exact cross-source duplicate, conflicts, independent same-name tasks, month boundary, zero hours, confirmation and stable repeated reads');

const privateTask={...task,reportToTeamSheets:false};
assert.equal(ledger([privateTask],[{...work,taskId:task.id}]).total,0);
const leaders=[{id:'m1',role:'副部長'},{id:'m2',role:'干事'}];assert.equal(ledger([task],[work],'',[],leaders).total,1.5);
const mirror={id:'source',memberId:'m1',title:'其他來源任務',date:'2026-10-20',hours:12,entered:true,sourceRefs:[]};assert.equal(ledger([],[],'',[mirror],leaders).total,0);
console.log('PASS personal tasks and linked work logs excluded; leadership hours excluded from task/work/source totals');
