import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const file=path.resolve('runtime',`task-followup-${process.pid}.mjs`);
await fs.mkdir(path.dirname(file),{recursive:true});
try{
 await fs.writeFile(file,ts.transpileModule(await fs.readFile('lib/task-followup.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const {taskVolunteerDate,followupTasks,followupReason,requiresMyReview}=await import(pathToFileURL(file).href);
 assert.equal(taskVolunteerDate({approvedAt:'2026-10-31T17:00:00.000Z',updatedAt:''}),'2026-11-01');
 const base={title:'任务',department:'运营部',status:'doing',priority:'normal',createdAt:'2026-10-01',updatedAt:'2026-10-01'};
 const cases=[{...base,id:'future-delegated',assignee:'成员甲',due:'2026-11-01'}, {...base,id:'overdue',due:'2026-10-19'}, {...base,id:'review',status:'review',due:'2026-11-10'}, {...base,id:'done',status:'done',reviewRequired:true,due:'2026-10-01'}, {...base,id:'self',reviewRequired:false,memberIds:['member1'],due:'2026-11-01'}, {...base,id:'waiting',status:'doing',reviewRequired:false}, {...base,id:'today',due:'2026-10-20'}, {...base,id:'no-date-review',status:'review'}, {...base,id:'no-date-delegated',memberIds:['member1']}, {...base,id:'unassigned',reviewRequired:true}];
 const before=JSON.stringify(cases),rows=followupTasks(cases,'2026-10-20');
 assert.equal(JSON.stringify(cases),before);
 assert.deepEqual(new Set(rows.map(t=>t.id)),new Set(['future-delegated','overdue','review','today','no-date-review','no-date-delegated','unassigned']));
 assert.ok(rows.slice(0,2).every(t=>t.status==='review'));assert.equal(rows[2].id,'overdue');assert.equal(rows[3].id,'today');
 assert.equal(followupReason(cases[2],'2026-10-20'),'审批中 · 待你确认');assert.equal(followupReason(cases[0],'2026-10-20'),'待审批 · 由你负责');
 assert.equal(followupReason(cases[9],'2026-10-20'),'待指定执行成员 · 由你审批');
 assert.equal(requiresMyReview(cases[4]),false);assert.equal(followupReason({...cases[2],reviewRequired:false},'2026-10-20'),'审批中 · 待你确认');
 assert.equal(followupReason({...cases[0],reviewRequired:false},'2026-10-20'),undefined);assert.equal(followupReason({...cases[0],status:'done'},'2026-10-20'),undefined);
 console.log('PASS review priority, delegated tasks before deadlines/without dates, explicit self-execution, completed exclusion and source preservation');
}finally{await fs.rm(file,{force:true});}
