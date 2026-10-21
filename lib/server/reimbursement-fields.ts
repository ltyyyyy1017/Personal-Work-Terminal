import type {ReimbActivity,Store} from "../types";
import {assert} from "../errors";
import {str} from "./http";
import {isReported} from "../reimbursement-progress";

export function applyReimbursementFields(a:ReimbActivity,b:Record<string,unknown>,s:Store){
 for(const key of ["handler","bankName","bankAccount"] as const)if(key in b)a[key]=str(b[key],"",150).trim();
 if("contact" in b)a.contact=str(b.contact,"",150).trim();
 if("matterId" in b)a.matterId=str(b.matterId,"",100)||undefined;
 if(a.matterId){const matter=s.matters.find(m=>m.id===a.matterId);assert(matter,"关联事务不存在，请重新选择");assert(matter.department===a.department,"报销与关联事务须属于同一部门");}
 if("reported" in b){assert(typeof b.reported==="boolean","上报状态格式不正确");a.reported=b.reported;}
 if("fundingStatus" in b){assert(b.fundingStatus==="unpaid"||b.fundingStatus==="paid","请选择有效的批款状态");a.fundingStatus=b.fundingStatus;}
 assert(a.fundingStatus!=="paid"||isReported(a),"请先标记已上报，再登记已批款");
 if("taxi" in b){
  if(b.taxi===null){a.taxi=undefined;}
  else {assert(b.taxi&&typeof b.taxi==="object"&&!Array.isArray(b.taxi),"打车资料格式不正确");const t=b.taxi as Record<string,unknown>;assert(Array.isArray(t.companions)&&t.companions.length<=50,"同行人最多 50 位");a.taxi={from:str(t.from,"",160).trim(),to:str(t.to,"",160).trim(),companions:[...new Set(t.companions.map(n=>str(n,"",60).trim()).filter(Boolean))]};a.category="交通差旅";}
 }
}
