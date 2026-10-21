import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const file=path.resolve('runtime',`equipment-borrowings-${process.pid}.mjs`);
await fs.mkdir(path.dirname(file),{recursive:true});
try{
 await fs.writeFile(file,ts.transpileModule(await fs.readFile('lib/equipment-borrowings.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const {equipmentBorrowings}=await import(pathToFileURL(file).href);
 const devices=[{id:'camera',name:'相机',model:'测试型号',status:'borrowed'},{id:'tripod',name:'三脚架',status:'available'},{id:'missing-record',name:'借出但缺少记录',status:'borrowed'}];
 const records=[{id:'r1',deviceId:'camera',deviceName:'旧名称',type:'borrow',returnedAt:null,createdAt:'2026-10-19T10:00:00Z',borrowerName:'测试甲',borrowerPhone:'not-for-dashboard',borrowerId:'private-id'}, {id:'returned',deviceId:'tripod',type:'borrow',returnedAt:'2026-10-20T10:00:00Z'}, {id:'deleted',deviceId:'tripod',type:'borrow',deletedAt:'2026-10-20T10:00:00Z'}, {id:'other',deviceName:'临时灯具',isOtherDevice:true,type:'borrow',createdAt:'2026-10-20T10:00:00Z'}, {id:'return-operation',deviceId:'tripod',type:'return'}, null];
 const before=JSON.stringify({devices,records}),items=equipmentBorrowings(devices,records);
 assert.equal(JSON.stringify({devices,records}),before);assert.equal(items.length,3);assert.equal(items[0].deviceName,'相机');assert.equal(items[0].borrowedAt,records[0].createdAt);assert.equal(items[1].isOtherDevice,true);assert.equal(items[2].missingRecord,true);
 assert.ok(!JSON.stringify(items).includes('not-for-dashboard'));assert.ok(!JSON.stringify(items).includes('private-id'));
 assert.equal(equipmentBorrowings(devices,[records[0],records[0]]).find(r=>r.deviceId==='camera').recordCount,1);
 const duplicates=equipmentBorrowings(devices,[records[0],{...records[0],id:'r2',borrowerName:'测试乙'}]);assert.equal(duplicates.filter(r=>r.deviceId==='camera').length,1);assert.equal(duplicates[0].recordCount,2);assert.equal(duplicates[0].borrowerName,'测试甲、测试乙');
 const afterReturn=equipmentBorrowings([{...devices[0],status:'available'}],[{...records[0],returnedAt:'2026-10-21T10:00:00Z'}]);assert.equal(afterReturn.length,0);
 assert.deepEqual(equipmentBorrowings([],[]),[]);
 console.log('PASS active unreturned filter, archived exclusion, inventory joins, createdAt dates, duplicate device counts, missing-record fallback, manual equipment and private-field omission');
}finally{await fs.rm(file,{force:true});}
