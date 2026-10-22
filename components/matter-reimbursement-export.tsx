"use client";
import {useState} from "react";
import {Download,LoaderCircle} from "lucide-react";
import type {Matter} from "@/lib/types";

export default function MatterReimbursementExport({matter,count,onExported}:{matter:Matter;count:number;onExported?:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function download(){
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/matters/${matter.id}/reimbursements/export`,{method:"POST"});
      if(!response.ok){const body=await response.json();throw new Error(body.error||"打包失败，请稍后重试");}
      const header=response.headers.get("content-disposition")||"";
      const encoded=header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename=encoded?decodeURIComponent(encoded):"事务全部报销材料.zip";
      const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");
      link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
      if(onExported)await onExported();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="matter-export"><button type="button" className="button secondary small" disabled={busy||!count} title={count?`打包此事务关联的 ${count} 笔报销` : "先将报销关联到此事务"} onClick={()=>void download()}>{busy?<LoaderCircle size={15} className="spin"/>:<Download size={15}/>} {busy?"正在整理全部材料…":`打包全部报销（${count}）`}</button>{error&&<p className="error-text" role="alert">{error}</p>}</div>;
}
