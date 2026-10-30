import {Converter} from "opencc-js/cn2t";
const traditional=Converter({from:'cn',to:'hk'});
const normalize=(value:string)=>traditional(value.normalize('NFKC').replace(/\s+/g,'').toLowerCase());
export function isOwnerClaim(submitter:string|undefined,ownerNames:string[]){if(!submitter?.trim())return false;const name=normalize(submitter);return ownerNames.some(n=>n.trim()&&normalize(n)===name);}
