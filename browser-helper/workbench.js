const origin=location.origin;
const reply=(type,extra={})=>window.postMessage({source:"workbench-login-helper",type,...extra},origin);
const ready=()=>reply("ready",{version:"2.0.0",capabilities:["scoped-authorization","fill-embedded-login","popup-login"]});
window.addEventListener("message",async event=>{
 if(event.source!==window||event.origin!==origin||event.data?.source!=="workbench")return;
 if(event.data.type==="login-helper-ping")return ready();
 if(typeof event.data.authorization!=="string")return;
 if(!["automatic-login","fill-embedded-login"].includes(event.data.type)||!["device-admin","news-review"].includes(event.data.id))return;
 try{const response=await fetch("/api/workspace/login-launch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:event.data.id,authorization:event.data.authorization}),cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"读取登录配置失败");const result=await chrome.runtime.sendMessage({type:event.data.type,id:event.data.id,popup:event.data.popup===true,...data});reply("result",{id:event.data.id,message:result?.message||"登录助手未返回结果，请重新加载扩展。"});}catch(e){reply("result",{id:event.data.id,message:e.message||"自动填写未完成"});}
});
chrome.runtime.onMessage.addListener(message=>{if(message.type==="workbench-login-result")reply("result",{id:message.id,message:message.message});});
ready();
