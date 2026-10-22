import type {Member,Task} from "./types";

/** Leadership work is recorded in the sheets without volunteer hours. */
export function isVolunteerLeader(member:Pick<Member,"role">|undefined){
  return Boolean(member&&/部[长長]|[负負][责責]人/.test(member.role||""));
}
export function volunteerMemberIds(task:Pick<Task,"memberIds">,members:Member[]){
  return (task.memberIds||[]).filter(id=>!isVolunteerLeader(members.find(m=>m.id===id)));
}
