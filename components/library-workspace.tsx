"use client";
import {useState} from "react";
import {BookOpen,ExternalLink,RefreshCw,PanelTop,ArrowUpRight} from "lucide-react";
import type {ResourceView} from "@/lib/types";

export const LIBRARY_RESOURCE:ResourceView={id:"library-reservation",title:"图书馆预约",url:"",category:"校园",organization:"个人",description:"图书馆预约，使用学校统一身份认证登录。",hasCredential:false};
export default function LibraryWorkspace({resource=LIBRARY_RESOURCE}:{resource?:ResourceView}){
 
 const [loaded,setLoaded]=useState(false),[version,setVersion]=useState(0);
 if(!resource.url)return <section className="panel"><div className="panel-heading"><h2>图书馆预约</h2></div><p className="member-empty">尚未配置预约入口。请通过工作入口导入接口配置 library-reservation 链接。</p></section>;
 function open(){window.open(resource.url,"_blank","popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes,noopener,noreferrer");}
 return <section className="panel library-workspace"><div className="panel-heading"><div><h2><BookOpen size={20}/>{resource.title}</h2><p>个人工作区 · 图书馆</p></div><a className="text-button" href={resource.url} target="_blank" rel="noopener noreferrer">独立打开<ArrowUpRight size={14}/></a></div><div className="library-connect"><div className="icon-tile blue"><BookOpen size={26}/></div><div><h3>图书馆预约，集中在这里。</h3><p>先在预约小窗口完成学校统一身份认证，再按需要载入工作区画面。学校若限制内嵌，可以继续在小窗口预约，工作台会保留在原处。</p><div className="library-actions"><button type="button" className="button primary" onClick={open}><ExternalLink size={15}/>打开预约小窗口</button><button type="button" className="button secondary" onClick={()=>{setLoaded(true);setVersion(n=>n+1);}}>{loaded?<RefreshCw size={15}/>:<PanelTop size={15}/>} {loaded?"刷新预约画面":"在工作区内载入"}</button>{loaded&&<button type="button" className="text-button" onClick={()=>setLoaded(false)}>收起画面</button>}</div><small>登录和预约结果以学校原站为准。请本人完成密码、验证码或扫码验证。</small></div></div>{loaded?<iframe key={version} title="图书馆预约" src={resource.url} className="workspace-frame library-frame" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-downloads"/>:<div className="library-placeholder"><BookOpen size={36}/><strong>预约工作区已就绪</strong><p>打开小窗口开始预约，或在登录后尝试载入原站画面。</p><span>{new URL(resource.url).hostname}</span></div>}</section>;
}
