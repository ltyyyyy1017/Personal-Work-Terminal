"use client";
import {useState,useEffect} from "react";
import type {Task,Member} from "@/lib/types";
import {todayStr} from "@/lib/date";
import {isVolunteerLeader} from "@/lib/task-reporting";
import EditorDialog from "./editor-dialog";
import {MemberPicker} from "./member-directory";

export default function TaskApproval({task,members,tasks,onClose,onSaved}:{task:Task;members:Member[];tasks:Task[];onClose:()=>void;onSaved:()=>Promise<void>}){
 const people=members.filter(m=>m.department===task.department);
 const [ownerPolicy,setOwnerPolicy]=useState(false);
 useEffect(()=>{let active=true;fetch("/api/team-sheets").then(r=>r.json()).then(d=>{if(active&&d.config?.recordOwnerWork){setOwnerPolicy(true);setReport(current=>current||"personal");}}).catch(()=>{});return()=>{active=false;};},[]);
 const [ids,setIds]=useState(task.memberIds?.length?task.memberIds:people.filter(m=>task.assignee?.split(/[、,，]/).includes(m.name)).map(m=>m.id));
 const [report,setReport]=useState<"include"|"personal"|"">(task.reportToTeamSheets===true?"include":task.reportToTeamSheets===false?"personal":"");
 const [entered,setEntered]=useState(task.volunteerEntered===true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [targets,setTargets]=useState<{tasks:{id:string;name:string}[];hours:{id:string;name:string}[]}|null>(null);
 const [taskSheetId,setTaskSheetId]=useState(task.sheetDestination?.taskSheetId||task.sheetOrigin?.task?.sheetId||""),[hoursSheetId,setHoursSheetId]=useState(task.sheetDestination?.hoursSheetId||task.sheetOrigin?.hours?.sheetId||""),[hoursKind,setHoursKind]=useState(task.sheetDestination?.hoursKind||"online");
 useEffect(()=>{if(report!=="include"&&!ownerPolicy)return;let active=true;fetch("/api/team-sheets/destinations").then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(active){setTargets(d);setError("");}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[report,ownerPolicy]);
 const countable=ids.filter(id=>!isVolunteerLeader(people.find(m=>m.id===id))),leaders=ids.filter(id=>!countable.includes(id));
 return <EditorDialog title={task.status==="done"?"任務紀錄與上報":"完結任務"} subtitle={task.title} onClose={()=>{if(!busy)onClose();}}>
  <form onChange={e=>{if((e.target as unknown as HTMLInputElement).name?.startsWith("hours_"))setEntered(false);}} onSubmit={async e=>{
   e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);
   try{
    if(!report)throw new Error("請選擇這項任務是否計入團委表格");
    if((report==="include"||ownerPolicy)&&(!taskSheetId||!hoursSheetId))throw new Error("請選擇兩張原表中要填入的頁籤");
    if(report==="include"&&!ids.length)throw new Error("請選擇執行成員");
    const hours=report==="include"?Object.fromEntries(countable.map(id=>{const raw=f.get(`hours_${id}`);if(raw===null||raw==="")throw new Error("請填寫幹事的志願時，無時長填 0");return [id,Number(raw)];})):undefined;
    const r=await fetch(`/api/tasks/${task.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:"done",reportToTeamSheets:report==="include",reviewedByOwner:ownerPolicy,memberIds:ids,...((report==="include"||ownerPolicy)?{sheetDestination:{taskSheetId,hoursSheetId,hoursKind},...(f.get("workDate")?{workDate:f.get("workDate")}:{})}:{}),...(report==="include"?{volunteerHours:hours,volunteerEntered:countable.length>0&&entered}:{})})}),d=await r.json();
    if(!r.ok)throw new Error(d.error);await onSaved();onClose();
   }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }}>
   <div className="form-grid">
    <fieldset className="reporting-options wide"><legend>{ownerPolicy?"其他執行成員是否一併上報志願時？":"這項任務是否計入團委表格？"}</legend>
     <label className={report==="include"?"selected":""}><input type="radio" name="reporting" value="include" checked={report==="include"} required onChange={()=>setReport("include")}/><span><strong>計入團委表格</strong><small>同步任務詳情；幹事填志願時，部長／副部長只列任務，時長留空。</small></span></label>
     <label className={report==="personal"?"selected":""}><input type="radio" name="reporting" value="personal" checked={report==="personal"} required onChange={()=>setReport("personal")}/><span><strong>{ownerPolicy?"僅記錄本人工作":"僅個人紀錄"}</strong><small>{ownerPolicy?"你的執行／審核工作仍寫入兩張原表，本人時長留空；其他成員暫不認定志願時。":"保留已完成紀錄，不寫入兩張團委表格，也不計算志願時。"}</small></span></label>
    </fieldset>
    {(report==="include"||ownerPolicy)&&<>
     <div className="report-destinations wide"><h3>填入原有表格的哪個頁籤？</h3><p className="field-help">不會新建分表。後續修改會核對並更新同一筆記錄。</p><div className="form-grid"><label className="field"><span>團學任務分工 · 頁籤</span><select required value={taskSheetId} onChange={e=>setTaskSheetId(e.target.value)}><option value="">{targets?"請選擇事項頁籤":"正在讀取原表…"}</option>{targets?.tasks.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field"><span>志願時匯總 · 頁籤</span><select required value={hoursSheetId} onChange={e=>setHoursSheetId(e.target.value)}><option value="">{targets?"請選擇事項頁籤":"正在讀取原表…"}</option>{targets?.hours.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field"><span>工作詳情填入</span><select value={hoursKind} onChange={e=>setHoursKind(e.target.value as "online"|"offline")}><option value="online">線上工作</option><option value="offline">線下出工</option></select></label></div></div>
     <label className="field wide"><span>實際完成日期</span><input type="date" name="workDate" required={report==="include"} defaultValue={task.workDate||task.due?.slice(0,10)||(task.sourceRefs?.length?"":todayStr())}/></label>
     <MemberPicker members={people} tasks={tasks} defaultIds={ids} onChange={next=>{setIds(next);setEntered(false);}} label="執行成員" hint="按實際參與者填寫；部長不登記志願時。"/>
     {leaders.length>0&&<p className="composer-hint wide">{leaders.map(id=>people.find(m=>m.id===id)?.name).join("、")}：只同步任務詳情，兩張表均不填時長，也不計入志願時統計。</p>}
     {report==="include"&&countable.map(id=><label className="field" key={id}><span>{people.find(m=>m.id===id)?.name} · 志願時（小時）</span><input name={`hours_${id}`} type="number" required min="0" max="1000" step="0.01" defaultValue={task.volunteerHours?.[id]??task.sourceHours?.[id]??""} placeholder="無時長填寫 0"/></label>)}
     {report==="include"&&countable.length>0&&<label className="field wide"><span>志願時錄入情況</span><select value={entered?"entered":"unentered"} onChange={e=>setEntered(e.target.value==="entered")}><option value="unentered">未錄入</option><option value="entered">已錄入</option></select><small className="field-help">指是否已錄入志願時系統；同步任務不會自動標成已錄入。</small></label>}
    </>}
    {report==="personal"&&!ownerPolicy&&<p className="composer-hint wide">完成後仍可在事項內查看。本任務及其關聯出工不計入志願時；若曾同步，會清理工作台新增的對應內容；原表既有資料會保留。</p>}
    {error&&<p role="alert" className="error-text wide">{error}</p>}
   </div>
   <footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy||!report||(report==="include"||ownerPolicy)&&(!targets||!taskSheetId||!hoursSheetId)}>{busy?"保存中…":task.status==="done"?"保存紀錄":report==="personal"?ownerPolicy?"完成並記錄本人工作":"完成並僅作個人紀錄":"通過並計入表格"}</button></footer>
  </form>
 </EditorDialog>;
}
