"use client";
import {useState} from "react";
import {Camera,RefreshCw} from "lucide-react";
import type {ResourceView} from "@/lib/types";
import EquipmentWorkspace from "./equipment-workspace";
import SiteLoginControls from "./site-login-controls";
export default function EquipmentPortal({onMessage,resource}:{onMessage:(message:string)=>void;resource?:ResourceView}){
 
 const [mode,setMode]=useState<"original"|"overview">("original"),[version,setVersion]=useState(0),[frameLoad,setFrameLoad]=useState(0);
 if(!resource?.url)return <section className="panel"><div className="panel-heading"><h2>设备管理</h2></div><p className="member-empty">尚未配置设备入口。请通过工作入口导入接口配置 device-admin 链接。</p></section>;
 return <><section className="panel equipment-portal"><div className="panel-heading"><div><h2><Camera size={18}/>设备管理</h2><p>示例组织二 · 运营部</p></div><div className="tabs"><button className={mode==="original"?"active":""} onClick={()=>setMode("original")}>原站管理</button><button className={mode==="overview"?"active":""} onClick={()=>setMode("overview")}>设备概览</button></div></div>{mode==="original"&&<><div className="equipment-launch-content"><p>在这里使用设备原站的完整管理界面，也可以打开独立小窗口。</p>{resource&&<SiteLoginControls resource={resource} embedded frameLoad={frameLoad} onMessage={onMessage}/>}<button className="text-button" onClick={()=>setVersion(n=>n+1)}><RefreshCw size={13}/>重新载入原站</button></div><iframe key={version} src={resource.url} title="设备原站管理" className="workspace-frame equipment-original-frame" onLoad={()=>setFrameLoad(n=>n+1)} allow="clipboard-read; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-downloads allow-top-navigation-by-user-activation"/></>}</section>{mode==="overview"&&<EquipmentWorkspace onMessage={onMessage}/>}</>;
}
