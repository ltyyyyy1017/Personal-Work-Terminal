"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {X} from "lucide-react";
export default function EditorDialog({title,subtitle,children,onClose}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="modal editor-dialog" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-inner"><header><div><div className="eyebrow">MY WORKSPACE</div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭编辑窗口"><X size={20}/></button></header>{children}</div></dialog>;
}
