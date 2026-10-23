const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript');
process.env.WORKBENCH_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-source-updates-'));process.env.WORKBENCH_SKIP_SYNC='true';
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {readStore,mutateStore}=require('../lib/store.ts'),{pullTeamSheets}=require('../lib/team-sheet-sync.ts'),{pullKdocs}=require('../lib/kdocs-sync.ts'),{parseAssignments,parseVolunteer}=require('../lib/team-sheet-data.ts'),{parseKdocsSheet}=require('../lib/kdocs-data.ts'),{mergeSourceTask,SOURCE_POLL_MS}=require('../lib/source-task.ts');
const cell=(row,col,value)=>typeof value==='number'?{row,col,value_type:'NUMBER',number_value:value}:{row,col,value_type:'STRING',string_value:value};
const cells=rows=>rows.flatMap((r,i)=>r.map((v,j)=>cell(i,j,v)));
const members=[{id:'p',name:'测试成员甲',department:'运营部',role:'干事'},{id:'i',name:'測試成員乙',department:'行政部'},{id:'r',name:'測試負責人',department:'行政部'}];
const taskSheet={sheet_id:'t',sheet_name:'运营部测试事项',row_count:30,col_count:10,sheet_type:'worksheet'},hourSheet={sheet_id:'h',sheet_name:'运营部测试事项',row_count:30,col_count:10,sheet_type:'worksheet'};
let title='现场摄影',date='2026-10-20',description='2026-10-20 现场摄影1h',hours=1,person='測試成員甲、測試成員乙',present=true;
const fakeTencent={async info(file){return{sheets:[file==='task-file'?taskSheet:hourSheet]};},async read(file){return{cells:file==='task-file'?cells([['序号','时间','任务','姓名','联系方式','完成情况'],['运营部（部长填写）'],...(present?[[1,date,title,person,'','完成']]:[]),[2,date,'其他部门工作','測試成員乙','','完成']]):cells([['序号','姓名','部门','线上','线下','汇总','录入情况','日期'],...(present?[[1,'測試成員甲','运营部',description,'',hours,'未录入',date]]:[]),[2,'陌生姓名','运营部','外部1h','',1,'',date],[3,'測試成員乙','运营部','其他部门2h','',2,'',date]])};}};
const mapping={sheetId:4,headerRow:0,titleColumn:0,memberColumn:1,dateColumn:2,activityColumn:3,noteColumn:4,statusColumn:5,responsibleColumn:6};
let ktitle='搬运物资',kdate='2026-10-20',kperson='测试成员乙、测试成员甲',kresponsible='测试负责人',kstatus='已完成';
const kcell=(row,col,value,recordId)=>({rowFrom:row,rowTo:row,colFrom:col,colTo:col,cellText:value,recordId});
const fakeKdocs={async info(){return{sheetsInfo:[{sheetId:4,sheetName:'工作',sheetType:'db',rowFrom:0,rowTo:10,colFrom:0,colTo:6,isVisible:true}]};},async read(){const rows=[['工作事项','姓名','日期','所属活动','备注','状态','项目负责人'],[ktitle,kperson,kdate,'测试活动','来源备注',kstatus,kresponsible],['外部工作','测试成员甲',kdate,'测试活动','','已完成','测试成员甲'],['仅负责的任务','测试成员甲',kdate,'测试活动','','进行中','测试负责人']];return{detail:{rangeData:rows.flatMap((r,row)=>r.map((v,col)=>kcell(row,col,v,row?'row-'+row:undefined)))}};}};
(async()=>{
 assert.equal(SOURCE_POLL_MS,300000);
 await mutateStore(s=>{s.members=members;s.teamSheets={enabled:true,department:'运营部',taskFileId:'task-file',hoursFileId:'hour-file',academicYear:2026,enabledAt:'2026-10-01',volunteers:[],issues:[],importedCount:0,taskHashes:{}};s.kdocs={enabled:true,url:'https://www.kdocs.cn/l/exampleDemo123',department:'行政部',year:2026,mappings:[mapping],sheets:[],importedCount:0,performanceCount:0,issues:[],importHashes:{},publications:{},taskHashes:{}};});
 await pullTeamSheets(fakeTencent,readStore().teamSheets);await pullKdocs(fakeKdocs,readStore().kdocs);let s=readStore();
 assert.equal(s.tasks.filter(t=>t.department==='运营部').length,2);assert.equal(s.teamSheets.volunteers.length,1);
 const task=s.tasks.find(t=>t.title===title),sourceHours=s.tasks.find(t=>t.sourceHours),internal=s.tasks.find(t=>t.title===ktitle),responsible=s.tasks.find(t=>t.title==='仅负责的任务');
 assert.deepEqual(task.memberIds,['p']);assert.equal(task.assignee,'测试成员甲');assert.deepEqual(internal.memberIds,['i']);assert.equal(internal.assignee,'測試成員乙');assert.deepEqual(internal.sourceResponsibleMemberIds,['r']);assert.deepEqual(responsible.memberIds,[]);assert.deepEqual(responsible.sourceResponsibleMemberIds,['r']);assert.ok(!s.tasks.some(t=>t.title==='外部工作'));
 await mutateStore(s=>{for(const id of [task.id,internal.id]){const t=s.tasks.find(t=>t.id===id);t.note='我的本机备注';t.reviewRequired=true;}s.tasks.find(t=>t.id===task.id).volunteerHours={p:0.5};});
 title='现场摄影和整理';date='2026-10-21';description='2026-10-21 现场摄影2h';hours=2;ktitle='搬运物资和收尾';kdate='2026-10-21';kstatus='进行中';
 await pullTeamSheets(fakeTencent,readStore().teamSheets);await pullKdocs(fakeKdocs,readStore().kdocs);s=readStore();
 assert.equal(s.tasks.find(t=>t.id===task.id).title,title);assert.equal(s.tasks.find(t=>t.id===task.id).workDate,date);assert.equal(s.tasks.find(t=>t.id===task.id).note,'我的本机备注');assert.deepEqual(s.tasks.find(t=>t.id===task.id).volunteerHours,{p:0.5});assert.equal(s.tasks.find(t=>t.id===task.id).reviewRequired,true);
 assert.equal(s.tasks.find(t=>t.id===sourceHours.id).sourceHours.p,2);assert.equal(s.teamSheets.volunteers[0].hours,2);
 assert.equal(s.tasks.find(t=>t.id===internal.id).title,ktitle);assert.equal(s.tasks.find(t=>t.id===internal.id).workDate,kdate);assert.equal(s.tasks.find(t=>t.id===internal.id).status,'doing');assert.equal(s.tasks.find(t=>t.id===internal.id).note,'我的本机备注');assert.equal(s.tasks.find(t=>t.id===internal.id).reviewRequired,true);
 const ids=s.tasks.map(t=>t.id);await pullTeamSheets(fakeTencent,s.teamSheets);await pullKdocs(fakeKdocs,readStore().kdocs);assert.deepEqual(readStore().tasks.map(t=>t.id),ids);
 // Moving a row does not duplicate an unchanged content identity. Removing it
 // archives its task; a later reappearance restores the same task and approval.
 present=false;await pullTeamSheets(fakeTencent,readStore().teamSheets);assert.ok(readStore().tasks.find(t=>t.id===task.id).sourceMissing);present=true;await pullTeamSheets(fakeTencent,readStore().teamSheets);assert.equal(readStore().tasks.find(t=>t.id===task.id).sourceMissing,false);
 // Roster changes affect subsequent reads without importing any replacement person.
 await mutateStore(s=>{s.members=s.members.filter(m=>m.id!=='p');});await pullTeamSheets(fakeTencent,readStore().teamSheets);assert.equal(readStore().teamSheets.volunteers.length,0);assert.ok(readStore().tasks.filter(t=>t.department==='运营部').every(t=>t.sourceMissing));
 await mutateStore(s=>{s.members.push(members[0]);});await pullTeamSheets(fakeTencent,readStore().teamSheets);assert.equal(readStore().teamSheets.volunteers.length,1);assert.equal(readStore().tasks.find(t=>t.id===task.id).sourceMissing,false);
 // Same-field concurrent edits remain visible as conflicts across retries;
 // changes to an independent date must still flow through.
 const base={id:'x',title:'原名',department:'运营部',memberIds:['p'],status:'done',note:'原备注',workDate:'2026-10-20',updatedAt:'2026-10-20',createdAt:'2026-10-20'};mergeSourceTask(base,{...base},true);base.title='本机改名';const remote={...base,title:'原表改名',workDate:'2026-10-22',updatedAt:'2026-10-22'};assert.ok(mergeSourceTask(base,remote,true).includes('title'));assert.equal(base.title,'本机改名');assert.equal(base.workDate,'2026-10-22');assert.ok(mergeSourceTask(base,remote,true).includes('title'));
 assert.deepEqual(readStore().members.map(m=>m.id).sort(),members.map(m=>m.id).sort());
 console.log('PASS roster-only imports, mixed departments and simplified/traditional names, responsible-only work, document edits after local notes/approvals, source hour updates, stable IDs, repeat reads, removals/reappearance, roster changes and persistent field conflicts');
})().catch(e=>{console.error(e);process.exitCode=1;});
