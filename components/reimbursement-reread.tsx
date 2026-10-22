"use client";
import {useMemo,useState,useRef,useEffect} from "react";
import {ScanText} from "lucide-react";
import EditorDialog from "./editor-dialog";
import {recognitionLabels,summarizeRecognition,type RecognizedDocument,type RecognitionField} from "@/lib/reimbursement-recognition";
import type {ReimbActivity} from "@/lib/types";

const keys:RecognitionField[]=["item","name","handler","date","from","to","companions","amount"];
export default function ReimbursementReread({activity:a,onSaved}:{activity:ReimbActivity;onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState(""),[docs,setDocs]=useState<RecognizedDocument[]>([]),[chosen,setChosen]=useState<Partial<Record<RecognitionField,string>>>({}),[meta,setMeta]=useState(true);
 const abort=useRef<AbortController|null>(null);useEffect(()=>()=>abort.current?.abort(),[]);
 const summary=useMemo(()=>summarizeRecognition(docs),[docs]);
 async function request(url:string,method:string,body:unknown,signal?:AbortSignal){const r=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body),signal});const d=await r.json();if(!r.ok)throw new Error(d.error||"操作未完成，請重試");return d;}
 async function start(){setOpen(true);setBusy(true);setDocs([]);setChosen({});setError("");setMeta(true);const controller=new AbortController();abort.current=controller;const found:RecognizedDocument[]=[];
  try{for(const [i,file]of a.files.entries()){setProgress(`正在識別 ${i+1} / ${a.files.length}：${file.originalName}`);const d=await request(`/api/activities/${a.id}/recognize`,"POST",{fileId:file.id},controller.signal);found.push(d.result);setDocs([...found]);}
   const s=summarizeRecognition(found),values:Partial<Record<RecognitionField,string>>={};for(const key of keys)if(s.fields[key]&&(key!=="amount"||(a.currency==="CNY"&&a.items.length===1))&&(key!=="item"||a.items.length===1))values[key]=s.fields[key]!.value;setChosen(values);
  }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted){setBusy(false);setProgress("");}}
 }
 async function apply(){setBusy(true);setError("");try{
  if(chosen.amount&&(!Number.isFinite(Number(chosen.amount))||Number(chosen.amount)<=0))throw new Error("請填寫有效金額");
  const body:Record<string,unknown>={};for(const [key,target]of [["item","name"],["name","submitter"],["handler","handler"],["date","date"]]as const)if(chosen[key])body[target]=chosen[key];
  if(chosen.amount&&a.currency==="CNY")body.paidAmount=Number(chosen.amount);
  if(["from","to","companions"].some(k=>k in chosen))body.taxi={from:chosen.from??a.taxi?.from??"",to:chosen.to??a.taxi?.to??"",companions:chosen.companions!==undefined?chosen.companions.split(/[、,，;；\n]/).map(n=>n.trim()).filter(Boolean):a.taxi?.companions||[]};
  await request(`/api/activities/${a.id}`,"PATCH",body);
  if(a.items.length===1&&(chosen.item||chosen.amount)){const item:Record<string,unknown>={};if(chosen.item)item.name=chosen.item;if(chosen.amount){const amount=Number(chosen.amount);if(!Number.isFinite(amount)||amount<=0)throw new Error("請填寫有效金額");item.amount=amount;}await request(`/api/activities/${a.id}/items/${a.items[0].id}`,"PATCH",item);}
  if(meta)for(const doc of docs.filter(d=>d.method!=="unreadable"&&(d.kind==="发票"||d.kind==="同行人"))){await request(`/api/activities/${a.id}/files/${doc.id}`,"PATCH",{kind:doc.kind,...(doc.kind==="发票"?{meta:{...a.files.find(f=>f.id===doc.id)?.meta,...Object.fromEntries(Object.entries(doc.meta).filter(([,v])=>v!==undefined&&v!==null)),currency:doc.fields.currency}}:{})});}
  await onSaved();setOpen(false);
 }catch(e){setError((e as Error).message);await onSaved();}finally{setBusy(false);}}
 return <><button className="button secondary small" disabled={!a.files.length} onClick={()=>void start()}><ScanText size={14}/>重新識別材料</button>{open&&<EditorDialog title="重新識別材料" subtitle="核對來源與新結果，勾選要更新的資料。原始附件會保留。" onClose={()=>{abort.current?.abort();setOpen(false);setBusy(false);}}><div className="form-grid">
 {progress&&<p className="wide" role="status">{progress}</p>}
 {!busy&&docs.length>0&&<>{keys.filter(k=>summary.fields[k]||summary.conflicts.some(c=>c.field===k)).filter(k=>k!=="amount"||(a.currency==="CNY"&&a.items.length===1)).map(key=><label className="field wide" key={key}><span><input type="checkbox" checked={key in chosen} onChange={e=>setChosen(v=>{const next={...v};if(e.target.checked)next[key]=summary.fields[key]?.value||"";else delete next[key];return next;})}/> {recognitionLabels[key]}</span><input type={key==="date"?"date":key==="amount"?"number":"text"} step={key==="amount"?"0.01":undefined} value={chosen[key]??summary.fields[key]?.value??""} disabled={!(key in chosen)} onChange={e=>setChosen(v=>({...v,[key]:e.target.value}))}/><small>{summary.fields[key]?.sources.join("、")}</small>{summary.conflicts.find(c=>c.field===key)?.options.map(o=><button className="text-button" type="button" key={o.value} title={o.sources.join("、")} onClick={()=>setChosen(v=>({...v,[key]:o.value}))}>{o.value} · {o.sources.join("、")}</button>)}</label>)}
 <label className="field wide"><span><input type="checkbox" checked={meta} onChange={e=>setMeta(e.target.checked)}/> 更新發票識別資料與同行人材料分類</span></label>
 {docs.filter(d=>d.kind==="发票").map(d=><div className="wide" key={d.id}><strong>{d.name}</strong><p>購買方：{d.fields.buyer||"未識別"}<br/>稅號：{d.fields.taxId||"未識別"}<br/>票號：{d.fields.invoiceNo||"未識別"} · 金額：{d.fields.amount||"未識別"}<br/>開票日期：{d.meta.issuedAt||"未識別"}（不作費用日期）</p></div>)}
 {[...summary.warnings,...docs.flatMap(d=>d.warnings.map(w=>`${d.name}：${w}`))].map((w,i)=><p className="wide muted small" key={i}>{w}</p>)}</>}
 {error&&<p className="error-text wide" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" onClick={()=>{abort.current?.abort();setOpen(false);setBusy(false);}}>取消</button><button className="button primary" disabled={busy||!docs.length} onClick={()=>void apply()}>套用已勾選資料</button></footer></EditorDialog>}</>;
}
