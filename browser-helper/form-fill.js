async function fillLoginForm(credentials,submit,expectedHost){
 if(location.protocol!=="https:"||location.port||location.hostname!==expectedHost)return {filled:false};
 function visible(input){return input.getBoundingClientRect().width>0&&input.getBoundingClientRect().height>0;}
 let password;for(let attempt=0;attempt<30;attempt++){password=Array.from(document.querySelectorAll('input[type="password"]')).find(visible);if(password)break;await new Promise(resolve=>setTimeout(resolve,300));}
 if(!password)return {filled:false};
 const inputs=Array.from(document.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])')).filter(visible);
 const username=inputs.find(input=>/用户|账号|帐号|邮箱|手机|user|account|email/i.test(input.name+' '+input.id+' '+input.placeholder))||inputs[0];if(!username)return {filled:false};
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
 for(const [input,value] of [[username,credentials.username],[password,credentials.password]]){setter.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}
 if(!submit)return {filled:true,submitted:false};
 if(inputs.some(input=>/验证码|captcha|verification/i.test(input.name+' '+input.id+' '+input.placeholder)&&!input.value))return {filled:true,verification:true};
 const buttons=Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"]')).filter(visible);
 const login=buttons.find(button=>/^(登\s*录|登\s*入|sign\s*in|log\s*in)$/i.test((button.innerText||button.value||"").trim()));if(login&&!login.disabled){login.click();return {filled:true,submitted:true};}
 return {filled:true,submitted:false};
}
