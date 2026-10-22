"use client";
import {useDepartments,useDepartmentLabel} from "./department-context";
import {useState,type FormEvent} from "react";
import type {Settings,Department} from "@/lib/types";
import {organizationSettings} from "@/lib/organizations";
import {reimbursementExportFormat} from "@/lib/reimbursement-export-format";
export default function BillingSettings({settings,onSave,busy}:{settings:Settings;onSave:(body:unknown)=>Promise<unknown>;busy:boolean}){
  const departments=useDepartments(),departmentLabel=useDepartmentLabel();
  const [department,setDepartment]=useState<Department>("行政部");const current=organizationSettings(settings,department).reimbursement,report=reimbursementExportFormat(settings,department);
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);void onSave({reimbursement:{submitter:f.get("submitter"),exportFormats:{[department]:{format:f.get("exportFormat"),title:f.get("reportTitle")}}},billingProfiles:{[(departments.find(d=>d.id===department)?.organization||department)]:{invoiceTitle:f.get("invoiceTitle"),taxId:f.get("taxId")}}});}
  return <form onSubmit={submit}>
    <label className="field"><span>默认信息所属组织</span><select value={department} onChange={e=>setDepartment(e.target.value as Department)}>{departments.map(d=><option key={d.id} value={d.id}>{departmentLabel(d.id)}</option>)}</select></label>
    {!settings.billingProfiles?.[(departments.find(d=>d.id===department)?.organization||department)]&&settings.reimbursement.invoiceTitle&&<div className="legacy-billing"><p>旧版通用抬头尚未指定组织：{settings.reimbursement.invoiceTitle}。核对归属后可应用到当前组织。</p><button type="button" className="text-button" disabled={busy} onClick={()=>void onSave({billingProfiles:{[(departments.find(d=>d.id===department)?.organization||department)]:{invoiceTitle:settings.reimbursement.invoiceTitle,taxId:settings.reimbursement.taxId}}})}>应用旧版信息到当前组织</button></div>}
    <div key={`${department}-${current.invoiceTitle}-${current.taxId}-${report.format}-${report.title}`}>
      <label className="field"><span>报销人</span><input name="submitter" defaultValue={settings.reimbursement.submitter}/></label>
      <label className="field"><span>发票抬头</span><input name="invoiceTitle" defaultValue={current.invoiceTitle}/></label>
      <label className="field"><span>纳税人识别号</span><input name="taxId" defaultValue={current.taxId}/></label>
      <label className="field"><span>報銷表格格式</span><select name="exportFormat" defaultValue={report.format}><option value="standard">標準報銷明細</option><option value="income-expense">收支明細表（綠色模板）</option></select><small>每個部門可分別設定，單筆與整個事項匯出均適用。</small></label>
      <label className="field"><span>收支明細表標題 <em>選填</em></span><input name="reportTitle" defaultValue={report.title||""} placeholder="組織收支明細表" maxLength={160}/><small>例如屆次與學年；匯出時會自動接上費用日期及事項名稱。</small></label>
    </div>
    <button className="button primary" disabled={busy}>保存当前组织信息</button>
  </form>;
}
