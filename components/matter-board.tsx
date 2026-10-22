"use client";
import MatterReimbursementExport from "./matter-reimbursement-export";
import {useState,type ReactNode} from "react";
import {Plus,Pencil,FolderOpen,ArrowUpRight} from "lucide-react";
import type {Matter,Task,ReimbActivity} from "@/lib/types";
import EditorDialog from "./editor-dialog";
import {useDepartments,useDepartmentLabel} from "./department-context";
export function MatterBoard({matters,tasks,activities=[],onReimburse,onExported,onNew,onEdit,onAdd,renderTasks}:{matters:Matter[];tasks:Task[];activities?:ReimbActivity[];onReimburse?:(id:string)=>void;onExported?:()=>Promise<void>;onNew:()=>void;onEdit:(m:Matter)=>void;onAdd:(m:Matter)=>void;renderTasks:(tasks:Task[])=>ReactNode}){
 const [selected,setSelected]=useState<string|null>(null),label=useDepartmentLabel();
 const ungrouped=tasks.filter(t=>!t.matterId),current=matters.find(m=>m.id===selected);
 const children=current?tasks.filter(t=>t.matterId===current.id):selected==="ungrouped"?ungrouped:[];
 const bills=current?activities.filter(a=>a.matterId===current.id):[];
 return <>
  <div className="matter-card-grid">
   {matters.map(m=>{const items=tasks.filter(t=>t.matterId===m.id),done=items.filter(t=>t.status==="done").length,review=items.filter(t=>t.status==="review").length,progress=items.length?Math.round(done/items.length*100):0;
    return <section className="matter-summary-card" key={m.id}>
     <button className="matter-summary-open" onClick={()=>setSelected(m.id)} aria-label={`查看${m.title}的子任務`}>
      <span className="matter-summary-top"><span className="matter-folder-icon"><FolderOpen size={23}/></span><span className="matter-summary-percent">{progress}<small>%</small></span></span>
      <span className="matter-summary-name">{m.title}</span><span className="matter-summary-meta">{label(m.department)}</span>
      <span className="matter-summary-date">{m.startDate?`${m.startDate}${m.endDate&&m.endDate!==m.startDate?` 至 ${m.endDate}`:""}`:"未設定日期"}</span>
      <span className="matter-summary-progress" role="progressbar" aria-label={`${m.title}完成進度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress}%`}}/></span>
      <span className="matter-summary-count"><span>{done} / {items.length} 項已完成</span><span>{review?`${review} 項待你審核`:"查看子任務"} <ArrowUpRight size={14}/></span></span>
     </button>
     <div className="matter-summary-actions"><button className="text-button" onClick={()=>onAdd(m)}><Plus size={15}/>添加子任務</button><button className="icon-button" aria-label={`編輯事項${m.title}`} onClick={()=>onEdit(m)}><Pencil size={16}/></button></div>
    </section>;
   })}
   {ungrouped.length>0&&<section className="matter-summary-card matter-ungrouped"><button className="matter-summary-open" onClick={()=>setSelected("ungrouped")}><span className="matter-folder-icon"><FolderOpen size={23}/></span><span className="matter-summary-name">未歸入事項</span><span className="matter-summary-meta">{ungrouped.length} 項獨立任務</span><span className="matter-summary-date">點開查看，或編輯任務選擇所屬事項</span><span className="matter-summary-count"><span>{ungrouped.filter(t=>t.status==="done").length} 項已完成</span><ArrowUpRight size={16}/></span></button></section>}
  </div>
  {!matters.length&&!ungrouped.length&&<section className="panel matter-welcome"><FolderOpen size={30}/><h2>先建一件大事，再拆分子任務</h2><p>例如「換屆大會」，再安排搬運物資、佈置、攝影與報銷。</p><button className="button primary" onClick={onNew}><Plus size={16}/>新建事項</button></section>}
  {(current||selected==="ungrouped")&&<EditorDialog className="matter-detail-dialog" title={current?.title||"未歸入事項的任務"} subtitle={`${children.filter(t=>t.status==="done").length} / ${children.length} 項已完成${current?` · ${label(current.department)}`:""}`} onClose={()=>setSelected(null)}>
   <div className="matter-detail-content">
    {current&&<><div className="matter-detail-toolbar"><button className="button secondary small" onClick={()=>onEdit(current)}><Pencil size={15}/>編輯事項</button><button className="button primary small" onClick={()=>onAdd(current)}><Plus size={15}/>添加子任務</button></div>{current.note&&<p className="matter-note">{current.note}</p>}<MatterReimbursementExport matter={current} count={bills.length} onExported={onExported}/>{bills.length>0&&<div className="matter-reimbursements"><span>關聯報銷</span>{bills.map(a=><button key={a.id} className="text-button" onClick={()=>{setSelected(null);onReimburse?.(a.id);}}>{a.name} · ¥{a.items.reduce((n,i)=>n+(i.amount||0),0).toFixed(2)}</button>)}</div>}</>}
    {children.length?renderTasks(children):current&&<button className="matter-empty" onClick={()=>onAdd(current)}>添加第一項子任務 <Plus size={15}/></button>}
   </div><footer className="modal-footer"><button className="button secondary" onClick={()=>setSelected(null)}>返回事項</button></footer>
  </EditorDialog>}
 </>;
}
export function MatterEditor({matter,defaultDepartment,onClose,onSaved}:{matter:Partial<Matter>;defaultDepartment:string;onClose:()=>void;onSaved:()=>Promise<void>}){const departments=useDepartments(),[busy,setBusy]=useState(false),[error,setError]=useState("");return <EditorDialog title={matter.id?"编辑事务":"新建事务"} subtitle="先确定大事，再分别安排负责人和子任务。" onClose={()=>{if(!busy)onClose();}}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{const r=await fetch(`/api/matters${matter.id?`/${matter.id}`:""}`,{method:matter.id?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});const d=await r.json();if(!r.ok)throw new Error(d.error);await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><div className="form-grid"><label className="field wide"><span>事务名称</span><input name="title" required maxLength={200} defaultValue={matter.title} placeholder="例如：第十三届换届大会"/></label><label className="field wide"><span>归属部门</span><select name="department" defaultValue={matter.department||defaultDepartment}>{departments.map(d=><option key={d.id} value={d.id}>{d.organization} · {d.name}</option>)}</select></label><label className="field"><span>开始日期</span><input name="startDate" type="date" defaultValue={matter.startDate}/></label><label className="field"><span>结束日期（含当日）</span><input name="endDate" type="date" defaultValue={matter.endDate}/></label><p className="composer-hint wide">填写日期后事务会显示在日历中；子任务按各自截止日期显示。</p><label className="field wide"><span>整体说明</span><textarea name="note" rows={3} defaultValue={matter.note} maxLength={1500}/></label>{error&&<p className="error-text wide" role="alert">{error}</p>}</div><footer className="modal-footer">{matter.id&&<button type="button" className="button danger ghost" disabled={busy} onClick={async()=>{if(!confirm("仅空事务可以删除，确认删除？"))return;setBusy(true);try{const r=await fetch(`/api/matters/${matter.id}`,{method:"DELETE"}),d=await r.json();if(!r.ok)throw new Error(d.error);await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>删除事务</button>}<div className="spacer"/><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy?"保存中…":"保存事务"}</button></footer></form></EditorDialog>;}
