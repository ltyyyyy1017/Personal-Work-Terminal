"use client";
import {useState} from "react";
import {ArrowUpRight,ChevronLeft,RefreshCw,ExternalLink} from "lucide-react";
import SiteLoginControls from "./site-login-controls";
import type {ResourceView} from "@/lib/types";
export default function WorkspaceEmbed({resource,onBack}:{resource:ResourceView;onBack:()=>void}){
  const [version,setVersion]=useState(0),[frameLoad,setFrameLoad]=useState(0);
  return <section className="panel embed-workspace"><div className="panel-heading"><div><button className="text-button back-link" onClick={onBack}><ChevronLeft size={14}/>返回工作入口</button><h2>{resource.title}</h2><p>使用原网站的编辑权限和登录状态，修改直接保存到原网站。</p></div><div className="row gap"><button className="icon-button" aria-label="刷新内嵌工作区" onClick={()=>setVersion(v=>v+1)}><RefreshCw size={17}/></button><a className="button secondary small" href={resource.url} target="_blank" rel="noreferrer"><ArrowUpRight size={14}/>独立窗口</a></div></div><div className="embed-login-note">{resource.category==="团学"?"若提示登录，请在文档内用有权限的微信或 QQ 扫码。扫码和第三方验证码仍需本人完成，工作台不会绕过验证。":"连接新版浏览器助手后，下方登录页面载入时会填写已保存的账号密码。验证码或协议确认请本人完成。"}</div>{resource.hasCredential&&<SiteLoginControls resource={resource} embedded frameLoad={frameLoad}/>}<iframe onLoad={()=>setFrameLoad(n=>n+1)} key={version} title={resource.title} src={resource.url} className="workspace-frame" allow="clipboard-read; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-downloads allow-top-navigation-by-user-activation"/></section>;
}
