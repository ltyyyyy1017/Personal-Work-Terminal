import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dirs, ensureDirs } from "./store";
import {atomicWrite} from "./atomic-file";
import {assert} from "./errors";

type Credential = {username:string; password:string};
const vaultPath=()=>path.join(dirs.root,"credentials.enc.json");
const keyPath=()=>process.env.WORKBENCH_VAULT_KEY_FILE||path.join(dirs.root,"credentials.key");
function key(create=false):Buffer {
  if(process.env.WORKBENCH_VAULT_KEY){
    const k=Buffer.from(process.env.WORKBENCH_VAULT_KEY,"base64");
    if(k.length!==32)throw new Error("WORKBENCH_VAULT_KEY 须为 32 字节的 Base64 密钥");
    return k;
  }
  if(fs.existsSync(keyPath()))return fs.readFileSync(keyPath());
  if(!create)throw new Error("凭据密钥文件缺失，请恢复数据目录中的密钥");
  ensureDirs();const k=crypto.randomBytes(32);fs.writeFileSync(keyPath(),k,{flag:"wx",mode:0o600});return k;
}
function read():Record<string,Credential> {
  if(!fs.existsSync(vaultPath()))return {};
  const envelope=JSON.parse(fs.readFileSync(vaultPath(),"utf8"));
  const decipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(envelope.iv,"base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,"base64")),decipher.final()]).toString("utf8"));
}
export function credentialMeta(){return Object.fromEntries(Object.entries(read()).map(([id,c])=>[id,{username:c.username,hasCredential:true}]));}
export function getCredential(id:string):Credential|undefined{return read()[id];}
export function saveCredentials(additions:Record<string,Credential>){
  const credentials={...read(),...additions};
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",key(true),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(credentials),"utf8"),cipher.final()]);
  atomicWrite(vaultPath(),JSON.stringify({version:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")}));
}
export function validResourceId(id:string){return /^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!["github","icloud","deepseek","__proto__","constructor","prototype"].includes(id.toLowerCase());}
export function getResourceCredential(id:string):Credential|undefined {
  assert(validResourceId(id),"该名称不能用作工作入口凭据");const values=read();return values[`resource:${id}`]||values[id];
}
export function saveResourceCredentials(additions:Record<string,Credential>){
  const entries=Object.entries(additions);assert(entries.length<=100,"凭据数量超出限制");
  for(const [id]of entries)assert(validResourceId(id),"该名称不能用作工作入口凭据");
  saveCredentials(Object.fromEntries(entries.map(([id,c])=>[`resource:${id}`,c])));
}
/** Migrate only known resource keys; integration keys can never be reinterpreted as a resource. */
export function migrateResourceCredentials(ids:string[]){
  const values=read();let changed=false;
  for(const id of ids){if(validResourceId(id)&&Object.hasOwn(values,id)){values[`resource:${id}`]??=values[id];delete values[id];changed=true;}}
  if(changed){
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(true),iv),data=Buffer.concat([cipher.update(JSON.stringify(values),"utf8"),cipher.final()]);
    atomicWrite(vaultPath(),JSON.stringify({version:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")}));
  }
}

export function removeCredentials(ids:string[]){if(!fs.existsSync(vaultPath()))return;const values=read();if(!ids.some(id=>Object.hasOwn(values,id)))return;for(const id of ids)delete values[id];const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(),iv),data=Buffer.concat([cipher.update(JSON.stringify(values),"utf8"),cipher.final()]);atomicWrite(vaultPath(),JSON.stringify({version:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")}));}
