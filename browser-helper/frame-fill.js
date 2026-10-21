chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(location.protocol!=="https:"||location.port)return;
 if(sender.id!==chrome.runtime.id||message.type!=="workbench-fill-frame"||!["login.example.invalid","equipment.example.invalid"].includes(location.hostname)||message.host!==location.hostname)return;
 const parents=Array.from(location.ancestorOrigins||[]);if(!parents.some(origin=>["http://127.0.0.1:3939","http://localhost:3939"].includes(origin)))return;
 fillLoginForm(message.credentials,false,location.hostname).then(sendResponse).catch(()=>sendResponse({filled:false}));return true;
});
