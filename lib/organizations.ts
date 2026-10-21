import type {Department,Settings,DepartmentProfile} from "./types";
export const ORGANIZATIONS:Record<string,string>={"行政部":"示例组织一","运营部":"示例组织二","个人":"个人"};
export const DEFAULT_DEPARTMENTS:DepartmentProfile[]=[{id:"行政部",name:"行政部",organization:"示例组织一",roles:["部长","副部长","干事"],modules:["tasks","members","calendar","reimburse","performance"]},{id:"运营部",name:"运营部",organization:"示例组织二",roles:["部长","副部长","干事"],modules:["tasks","members","worklogs","devices","calendar","reimburse","resources"]},{id:"个人",name:"个人",organization:"个人",roles:[],modules:["tasks","calendar"]}];
export const departmentProfiles=(settings?:Pick<Settings,"departmentProfiles">)=>settings?.departmentProfiles||DEFAULT_DEPARTMENTS;
export const organizationFor=(d:Department,settings?:Pick<Settings,"departmentProfiles">)=>departmentProfiles(settings).find(p=>p.id===d)?.organization||ORGANIZATIONS[d]||d;
export const departmentLabel=(d:Department,settings?:Pick<Settings,"departmentProfiles">)=>{const p=departmentProfiles(settings).find(p=>p.id===d);return d==="个人"?"个人事务":`${p?.organization||ORGANIZATIONS[d]||""}${p?.organization||ORGANIZATIONS[d]?" · ":""}${p?.name||d}`;};
export function organizationSettings(settings:Settings,department:Department):Settings {
  const organization=organizationFor(department,settings);
  const profile=settings.billingProfiles?.[organization];
  // Older defaults did not carry an organization. Keep them available in settings,
  // but do not silently assign a financial identity to either organization.
  return {...settings,org:organization,reimbursement:{...settings.reimbursement,invoiceTitle:profile?.invoiceTitle??"",taxId:profile?.taxId??""}};
}
