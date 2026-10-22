"use client";
import {useState} from "react";
import {ArrowUp,ArrowDown,GripVertical,Pencil,Plus,Search,UsersRound,LayoutGrid,List,CheckCheck} from "lucide-react";
import type {Member,Task} from "@/lib/types";
import {useDepartmentLabel} from "./department-context";
import MemberEditor from "./member-editor";
import MemberAvatar from "./member-avatar";

export default function MemberManagement({members,tasks,onAssign,onChange}:{members:Member[];tasks:Task[];onAssign:(id:string)=>void;onChange:()=>Promise<void>}){
 const departmentLabel=useDepartmentLabel();
 const [search,setSearch]=useState(""),[role,setRole]=useState("all"),[view,setView]=useState("cards"),[edit,setEdit]=useState<Member|null>(null),[drag,setDrag]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const filtered=!!search.trim()||role!=="all";
 const related=(m:Member)=>tasks.filter(t=>t.memberIds?.includes(m.id)||t.department===m.department&&t.assignee===m.name);
 const active=tasks.filter(t=>t.status!=="done"&&members.some(m=>t.memberIds?.includes(m.id)||t.department===m.department&&t.assignee===m.name));
 const visible=members.filter(m=>(role==="all"||(m.role||"成員")===role)&&`${m.name} ${m.role||""} ${m.className||""} ${m.school||""} ${m.preference||""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 async function reorder(from:string,to:string){
  if(!from||from===to||saving||filtered)return;setSaving(true);setError("");
  try{const ids=members.map(m=>m.id),a=ids.indexOf(from),b=ids.indexOf(to);if(a<0||b<0)return;ids.splice(a,1);ids.splice(b,0,from);
   const r=await fetch("/api/members/order",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({ids})});if(!r.ok)throw new Error((await r.json()).error);await onChange();
  }catch(e){setError((e as Error).message);}finally{setDrag("");setSaving(false);}
 }
 return <section className="panel member-directory">
  <div className="panel-heading"><div><span className="directory-eyebrow">團隊通訊錄</span><h2>成員管理</h2><p>編輯資料、安排任務，讓每個人的工作一目了然。</p></div><div className="directory-summary"><span><UsersRound size={16}/><b>{members.length}</b> 位成員</span><span><CheckCheck size={16}/><b>{active.length}</b> 項進行中</span></div></div>
  <div className="directory-toolbar"><div className="search"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} aria-label="搜尋成員" placeholder="搜尋姓名、班級、專長…"/></div><select aria-label="篩選成員職務" value={role} onChange={e=>setRole(e.target.value)}><option value="all">全部職務</option>{[...new Set(members.map(m=>m.role||"成員"))].map(r=><option key={r}>{r}</option>)}</select><span className="directory-visible">{visible.length} 位</span><div className="directory-view" role="group" aria-label="顯示方式"><button aria-label="卡片檢視" aria-pressed={view==="cards"} onClick={()=>setView("cards")}><LayoutGrid size={18}/></button><button aria-label="列表檢視" aria-pressed={view==="list"} onClick={()=>setView("list")}><List size={19}/></button></div></div>
  {error&&<p className="error-text inline-error" role="alert">{error}</p>}
  <div className={`member-directory-grid ${view==="list"?"directory-list":""}`}>{visible.map(m=>{const index=members.findIndex(n=>n.id===m.id),own=related(m),unfinished=own.filter(t=>t.status!=="done").length,tone=m.id.split("").reduce((a,c)=>a+c.charCodeAt(0),0)%4;
   return <article key={m.id} data-tone={tone} className={`member-card editable-member ${drag===m.id?"dragging":""}`} onDragOver={e=>{if(drag&&!filtered){e.preventDefault();e.dataTransfer.dropEffect="move";}}} onDrop={e=>{e.preventDefault();void reorder(drag,m.id);}}>
    <div className="member-card-top"><button type="button" className="drag-handle icon-button" disabled={saving||filtered} draggable={!saving&&!filtered} onDragStart={e=>{setDrag(m.id);e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",m.id);}} onDragEnd={()=>setDrag("")} aria-label={`拖動排序${m.name}`} title={filtered?"清除篩選後可排序":"拖動排序"}><GripVertical size={18}/></button>
    <button type="button" className="member-avatar-button" aria-label={`編輯${m.name}的頭像`} onClick={()=>setEdit(m)}><MemberAvatar member={m}/></button>
    <div className="member-identity"><strong>{m.name}</strong><small>{m.role||"成員"}</small></div><button className="member-edit-action" aria-label={`編輯成員${m.name}`} onClick={()=>setEdit(m)}><Pencil size={15}/><span>編輯</span></button></div>
    <div className="member-information"><p className="member-organization">{departmentLabel(m.department)}</p><p className="member-class">{[m.school,m.className].filter(Boolean).join(" · ")||"尚未填寫學校或班級"}</p><p className="member-specialty">{m.preference?`專長／意向：${m.preference}`:"點擊編輯，補充成員資料"}</p></div>
    <div className="member-workload"><span><b>{unfinished}</b> 進行中 <small>／{own.filter(t=>t.status==="done").length} 已完成</small></span><button className="text-button" onClick={()=>onAssign(m.id)}><Plus size={16}/>安排任務</button></div>
    <div className="member-order-controls"><small>{saving?"正在儲存順序…":`#${String(index+1).padStart(2,"0")}`}</small><div><button className="icon-button" disabled={saving||index===0||filtered} aria-label={`上移${m.name}`} onClick={()=>void reorder(m.id,members[index-1].id)}><ArrowUp size={16}/></button><button className="icon-button" disabled={saving||index===members.length-1||filtered} aria-label={`下移${m.name}`} onClick={()=>void reorder(m.id,members[index+1].id)}><ArrowDown size={16}/></button></div></div>
   </article>;
  })}</div>
  {!visible.length&&<div className="directory-empty"><UsersRound size={34}/><h3>沒有符合的成員</h3><p>試試其他姓名或職務。</p><button className="button secondary" onClick={()=>{setSearch("");setRole("all");}}>清除篩選</button></div>}
  <p className="directory-footnote">{filtered?"清除篩選後可拖動排序。":"拖動卡片左側把手調整順序；也可使用上下箭頭。"}順序會自動儲存。</p>
  {edit&&<MemberEditor key={edit.id} member={edit} onClose={()=>setEdit(null)} onSaved={onChange}/>}
 </section>;
}
