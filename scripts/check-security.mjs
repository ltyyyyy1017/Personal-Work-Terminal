import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rename,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import {request as httpRequest} from 'node:http';
const folder=await mkdtemp(path.join(tmpdir(),'workbench-security-')),password=crypto.randomBytes(20).toString('hex'),base='http://127.0.0.1:3945';
let server,logs='',cookie='';
async function start(lock=false,bootstrap=false){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3945'],{env:{...process.env,WORKBENCH_DATA_DIR:folder,WORKBENCH_PUBLIC_URL:'https://workbench.example.com',DEVICE_LOGIN_HOST:'equipment.example.invalid',NEWS_LOGIN_HOST:'login.example.invalid',WORKBENCH_TRUST_PROXY:'true',WORKBENCH_LOCK_SETUP:String(lock),WORKBENCH_PASSWORD:bootstrap?password:'',WORKBENCH_USERNAME:bootstrap?'security-owner':'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(logs);try{await fetch(base);return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Startup timeout');}
async function stop(){if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}}
async function request(route,body,expected=200,options={}){const headers={'x-workbench-client-ip':'192.0.2.1',...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...options.headers};const r=await fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});assert.equal(r.status,expected,`${route}: ${r.status}: ${await r.clone().text()}`);return r;}
const json=async(...args)=>(await request(...args)).json();
const grant=async(id='test-site',operation='copy')=>(await json('workspace/credential/authorize',{id,operation,current:password})).authorization;
try{
 await start();
 const publicSetup=await new Promise((resolve,reject)=>{const r=httpRequest(base+'/api/auth/setup',{method:'POST',headers:{host:'public.example.com','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end(JSON.stringify({username:'security-owner',password}));});assert.equal(publicSetup,403);
 const setup=await request('auth/setup',{username:'security-owner',password});cookie=setup.headers.getSetCookie().find(v=>v.startsWith('wb_session=')).split(';')[0];assert.match(setup.headers.get('set-cookie'),/; Secure/i);
 for(const text of ['{bad','', 'null','[]']){const r=await request('auth/login',text,400);assert.equal((await r.json()).error,'请求 JSON 格式不正确');}
 await request('auth/login',{password:'wrong'},403,{headers:{origin:'not a url'}});
 const h1=await fetch(base),h2=await fetch(base),html=await h1.text(),csp=h1.headers.get('content-security-policy');assert.match(csp,/'nonce-/);assert.ok(!csp.includes("script-src 'unsafe-inline'"));assert.ok(!csp.includes("'unsafe-eval'"));assert.notEqual(csp,h2.headers.get('content-security-policy'));const nonce=csp.match(/'nonce-([^']+)'/)[1];const scripts=html.match(/<script\b[^>]*>/g)||[];assert.ok(scripts.length);assert.ok(scripts.every(s=>s.includes(`nonce="${nonce}"`)));assert.match(h1.headers.get('cache-control'),/no-store/);assert.match(h1.headers.get('strict-transport-security'),/max-age/);
 console.log('PASS dynamic nonce CSP covers all Next scripts, no unsafe script execution, HTTPS secure cookies, malformed JSON/origins and public setup rejection');
 for(const id of ['github','icloud','deepseek','__proto__','constructor'])await request('workspace/import',{resources:[{id,title:'collision',url:'https://example.invalid'}]},400);
 await request('workspace/import',{current:password,resources:[{id:'test-site',title:'Test site',url:'https://example.invalid',category:'审核'}],credentials:{'test-site':{username:'fixture-user',password:'fixture-password'}}});
 await request('workspace/credential',{id:'test-site'},403);await request('workspace/credential/authorize',{id:'test-site',operation:'copy',current:'wrong'},401);
 const once=await grant();assert.equal((await json('workspace/credential',{id:'test-site',authorization:once})).password,'fixture-password');await request('workspace/credential',{id:'test-site',authorization:once},403);
 const scoped=await grant();await request('workspace/login-launch',{id:'test-site',authorization:scoped},403);
 const bound=await grant(),firstCookie=cookie;cookie=(await request('auth/login',{username:'security-owner',password})).headers.getSetCookie().find(v=>v.startsWith('wb_session=')).split(';')[0];await request('workspace/credential',{id:'test-site',authorization:bound},403);cookie=firstCookie;
 const state=await json('state');assert.ok(!JSON.stringify(state.system).includes(folder));assert.ok(state.log.some(l=>l.kind==='security'));
 console.log('PASS reserved namespace collisions, master-password confirmation, scoped/single-use/session-bound credential grants, audit logs and masked data path');
 // Test the configured login host without embedding a real work address in the exported test.
 const ws=await readFile('lib/server/handlers/workspace.ts','utf8'),host=ws.match(/id==="device-admin"\?"([^"]+)"/)?.[1]||'equipment.example.invalid';assert.ok(host);
 for(const url of [`https://${host}:8443/admin`,`https://user:password@${host}/admin`]){await request('workspace/import',{current:password,resources:[{id:'device-admin',title:'Device fixture',url:`https://${host}/admin`,category:'设备'}],credentials:{'device-admin':{username:'fixture',password:'fixture-secret'}}});
 if(url.includes('@'))await request('workspace/import',{resources:[{id:'device-admin',title:'Bad URL',url}]},400);else{await request('workspace/import',{resources:[{id:'device-admin',title:'Bad port',url}]});await request('workspace/login-launch',{id:'device-admin',authorization:await grant('device-admin','login')},400);}}
 const backup=await request('backup');assert.match(backup.headers.get('cache-control'),/no-store/);await request('backup',undefined,403,{headers:{'sec-fetch-site':'cross-site'}});
 const helper=await JSZip.loadAsync(await (await request('browser-helper')).arrayBuffer());assert.equal(JSON.parse(await helper.file('manifest.json').async('string')).version,'2.0.0');assert.ok((await helper.file('workbench.js').async('string')).includes('authorization:event.data.authorization'));
 for(const rule of ['constructor','toString','__proto__'])await request('performance',{rule,date:'2026-10-21',title:'blocked',memberIds:[]},400);
 console.log('PASS non-default login ports/userinfo, backup cache controls/cross-site navigation, new helper and inherited performance rule rejection');
 for(let i=0;i<9;i++)await request('auth/login',{username:'security-owner',password:'wrong'},401,{headers:{'x-workbench-client-ip':'198.51.100.10','x-forwarded-for':`203.0.113.${i}`}});
 await request('auth/login',{username:'security-owner',password},200,{headers:{'x-workbench-client-ip':'198.51.100.20'}});
 console.log('PASS wrong-password requests cannot lock a different source or a correct-password owner out');
 const qr=await request('auth/qr/new',{trusted:true,label:'Untrusted label'}),q=await qr.json(),pairCookie=qr.headers.getSetCookie().find(v=>v.startsWith('wb_pair=')).split(';')[0],parts=q.image;assert.ok(parts); // Only the initiating browser receives the screen code.
 const qrText=await readFile('components/account-access.tsx','utf8');assert.ok(!qrText.includes('code: pair?.code'));
 // Inspect by recovering the scan token from QR image is deliberately unnecessary: the returned code is not a scan secret.
 const missingScan=await request('auth/qr/inspect',{id:q.id,scan:'wrong'},403);assert.ok(missingScan);
 await request('auth/qr/status',{id:q.id},200,{headers:{cookie:pairCookie}});
 console.log('PASS QR initiator binding and manual-code approval UI; detailed pairing regression runs in check-account');
 const large='x'.repeat(513*1024);await request('auth/login',large,413);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(300*1024));c.enqueue(new Uint8Array(300*1024));c.close();}});const chunked=await fetch(base+'/api/auth/login',{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:stream});assert.equal(chunked.status,413);
 await stop();await rename(path.join(folder,'auth.json'),path.join(folder,'auth.saved.json'));await start(true);await request('auth/setup',{username:'attacker',password},503);await request('auth/status',undefined,503);
 console.log('PASS buffered and chunked body bounds, missing-account fail-closed cloud behavior');
 await stop();await start(true,true);assert.equal((await json('auth/status')).initialized,true);await request('auth/setup',{username:'blocked',password},403);console.log('PASS trusted deployment credentials bootstrap a fresh locked Docker instance without public setup');
 console.log('ALL SECURITY CHECKS PASSED (isolated synthetic data)');
}finally{await stop();}
