importScripts("form-fill.js");
const pending=new Map();
const origins=["http://127.0.0.1:3939","http://localhost:3939"];
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(!["automatic-login","fill-embedded-login"].includes(message.type))return;
 let source,target;try{source=new URL(sender.url);target=new URL(message.url);}catch{return;}
 const expected=message.id==="device-admin"?"equipment.example.invalid":message.id==="news-review"?"login.example.invalid":"";
 if(!origins.includes(source.origin)||target.hostname!==expected||target.protocol!=="https:"||target.username||target.password||target.port||!sender.tab?.id)return;
 if(message.type==="fill-embedded-login"){
  chrome.tabs.sendMessage(sender.tab.id,{type:"workbench-fill-frame",host:expected,credentials:{username:message.username,password:message.password}}).then(result=>sendResponse({message:result?.filled?"账号密码已填写，请核对并完成验证码或协议确认。":"当前画面未检测到登录表单；已登录时可直接使用。"})).catch(()=>sendResponse({message:"未连接到内嵌登录页，请重新加载 1.1 版助手并刷新工作台。"}));return true;
 }
 (async()=>{let tab;if(message.popup){const popup=await chrome.windows.create({url:target.href,type:"popup",width:1180,height:820});tab=popup.tabs?.[0];}else tab=await chrome.tabs.create({url:target.href});if(!tab?.id)throw new Error("No tab");pending.set(tab.id,{username:message.username,password:message.password,host:expected,source:sender.tab.id,id:message.id,expires:Date.now()+60000});setTimeout(()=>pending.delete(tab.id),60000);sendResponse({message:"已打开原站窗口，正在准备填写登录信息。"});if(tab.status==="complete")void finish(tab.id,tab);})().catch(()=>sendResponse({message:"未能打开原站窗口，请使用独立打开链接。"}));return true;
});
async function finish(tabId,tab){const entry=pending.get(tabId);if(!entry)return;let url;try{url=new URL(tab.url);}catch{return;}if(url.hostname!==entry.host)return;if(Date.now()>entry.expires){pending.delete(tabId);return;}pending.delete(tabId);try{const results=await chrome.scripting.executeScript({target:{tabId},func:fillLoginForm,args:[{username:entry.username,password:entry.password},true,entry.host]});const result=results[0]?.result;await chrome.tabs.sendMessage(entry.source,{type:"workbench-login-result",id:entry.id,message:result?.filled?(result.verification?"已填写账号密码，请在原站完成验证码。":result.submitted?"已填写并提交登录，如有验证或协议请本人完成。":"已填写账号密码，请核对原站画面。"):"未检测到登录表单；若原站已登录，可直接管理。"});}catch{try{await chrome.tabs.sendMessage(entry.source,{type:"workbench-login-result",id:entry.id,message:"原站窗口已打开，自动填写未完成，可使用工作台的复制账号、密码按钮。"});}catch{}}}
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(change.status==="complete")void finish(tabId,tab);});
