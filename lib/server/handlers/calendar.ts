import { mutateStore, newId, nowISO, readStore } from "../../store";
import { bool, isDateLike, json, str } from "../http";
import { AppError, assert } from "../../errors";
import type { CalEvent, Store, Task } from "../../types";
import { parseLocal } from "../../date";
import type { Ctx } from "../ctx";
import { memberIds } from "./workspace";
import {organizationFor,departmentProfiles} from "../../organizations";

const TAGS = ["行政部", "运营部", "个人", "会议", "截止", "差旅", "活动"];

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((t) => String(t).trim()).filter(Boolean))].slice(0, 8);
}

export function createEventInput(store: Store, body: Record<string, unknown>, source: CalEvent["source"]): CalEvent {
  const title = str(body.title).trim();
  assert(title, "日程标题不能为空");
  const startRaw = str(body.start).trim();
  assert(isDateLike(startRaw), "开始时间格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm");
  const allDay = bool(body.allDay, !startRaw.includes("T"));
  let end = isDateLike(body.end) ? str(body.end) : undefined;
  assert(!end || parseLocal(end) > parseLocal(startRaw), "结束时间必须晚于开始时间");
  const now = nowISO();
  const event: CalEvent = {
    organization:organizationFor(cleanTags(body.tags).find(t=>departmentProfiles(store.settings).some(p=>p.id===t))||"个人",store.settings),
    id: newId("evt"),
    title,
    start: startRaw,
    end,
    allDay,
    location: str(body.location, "", 120) || undefined,
    description: str(body.description, "", 2000) || undefined,
    tags: cleanTags(body.tags),
    source,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  store.events.push(event);
  return event;
}

export function applyEventPatch(event: CalEvent, body: Record<string, unknown>) {
  assert(!event.icloud?.readOnly,"此日程来自 iCloud，请在 Apple 日历中编辑，再读取更新",409);
  if (typeof body.title === "string") event.title = str(body.title).trim() || event.title;
  if (isDateLike(body.start)) {
    event.start = str(body.start);
    event.allDay = bool(body.allDay, !event.start.includes("T"));
  }
  if ("end" in body) {
    event.end = isDateLike(body.end) ? str(body.end) : undefined;
  }
  if ("allDay" in body) event.allDay = bool(body.allDay, event.allDay);
  if ("location" in body) event.location = str(body.location, "", 120) || undefined;
  if ("description" in body) event.description = str(body.description, "", 2000) || undefined;
  if ("tags" in body) event.tags = cleanTags(body.tags);
  event.organization=organizationFor(event.tags.find(t=>departmentProfiles(readStore().settings).some(p=>p.id===t))||"个人",readStore().settings);
  if ("done" in body) event.done = bool(body.done, false);
  assert(!event.end || parseLocal(event.end) > parseLocal(event.start), "结束时间必须晚于开始时间");
  event.updatedAt = nowISO();
}

export async function listEvents(ctx: Ctx) {
  const store = readStore();
  const from = ctx.url.searchParams.get("from");
  const to = ctx.url.searchParams.get("to");
  const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
  const tag = ctx.url.searchParams.get("tag");
  const events = store.events
    .filter((ev) => {
      const startDate = ev.start.slice(0, 10);
      const endDate = (ev.end ?? ev.start).slice(0, 10);
      if (from && endDate < from) return false;
      if (to && startDate > to) return false;
      if (tag && !ev.tags.includes(tag)) return false;
      if (q) {
        const hay = `${ev.title} ${ev.location ?? ""} ${ev.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  return json({ events });
}

export async function createEvent(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { store, result } = await mutateStore((s) => createEventInput(s, body, "ui"));
  return json({ event: result, events: store.events });
}

export async function patchEvent(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const ev = s.events.find((e) => e.id === ctx.params.id);
    if (!ev) throw new AppError("日程不存在", 404);
    applyEventPatch(ev, body);
    return ev;
  });
  return json({ event: result });
}

export async function deleteEvent(ctx: Ctx) {
  await mutateStore((s) => {
    const idx = s.events.findIndex((e) => e.id === ctx.params.id);
    if (idx < 0) throw new AppError("日程不存在", 404);
    s.events.splice(idx, 1);
  });
  return json({ ok: true });
}

/* ---------------------------------- tasks --------------------------------- */

export async function listTasks() {
  const store = readStore();
  const tasks = [...store.tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : b.status === "done" ? -1 : 0;
    return (a.due ?? "9999").localeCompare(b.due ?? "9999");
  });
  return json({ tasks });
}

export async function createTask(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const title = str(body.title).trim();
  assert(title, "任务标题不能为空");
  const now = nowISO();
  const task: Task = {
    id: newId("task"),
    title,
    reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : undefined,
    department: departmentProfiles(readStore().settings).some(p=>p.id===body.department)
      ? (body.department as Task["department"])
      : "个人",
    status: (["doing", "review", "done"] as const).includes(body.status as never)
      ? (body.status as Task["status"])
      : "doing",
    due: isDateLike(body.due) ? str(body.due) : undefined,
    priority: (["low", "normal", "high"] as const).includes(body.priority as never)
      ? (body.priority as Task["priority"])
      : "normal",
    note: str(body.note, "", 500) || undefined,
    assignee: str(body.assignee, "", 60),
    followUp: isDateLike(body.followUp) ? str(body.followUp) : undefined,
    link: safeLink(body.link),
    activityName: str(body.activityName, "", 120),
    kind: body.kind === "device" ? "device" : "task",
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((s) => {
    task.organization = organizationFor(task.department,s.settings);
    task.memberIds = memberIds(s, body.memberIds ?? [],task.department);
    task.matterId=validateMatter(s,body.matterId,task.department);
    assert(task.department!=="运营部"||task.status!=="done","运营部任务请创建后通过审批确认志愿时");
    task.assignee=task.memberIds.map(id=>s.members.find(m=>m.id===id)?.name).filter(Boolean).join("、")||task.assignee;
    s.tasks.push(task);
  });
  return json({ task });
}

export async function patchTask(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const task = s.tasks.find((t) => t.id === ctx.params.id);
    if (!task) throw new AppError("任务不存在", 404);
    const previousStatus=task.status;
    if (typeof body.title === "string") task.title = str(body.title).trim() || task.title;
    if (["todo", "doing", "waiting", "review", "done"].includes(body.status as string)) task.status = body.status==="review"||body.status==="done"?body.status:"doing";
    if ("assignee" in body) task.assignee = str(body.assignee, "", 60);
    if ("activityName" in body) task.activityName = str(body.activityName, "", 120);
    if ("followUp" in body) task.followUp = isDateLike(body.followUp) ? str(body.followUp) : undefined;
    if ("link" in body) task.link = safeLink(body.link);
    if ("kind" in body) task.kind = body.kind === "device" ? "device" : "task";
    if (typeof body.reviewRequired === "boolean") task.reviewRequired = body.reviewRequired;
    if (["low", "normal", "high"].includes(body.priority as string)) task.priority = body.priority as Task["priority"];
    if (departmentProfiles(s.settings).some(p=>p.id===body.department)) {
      task.department = body.department as Task["department"];
    }
    if ("due" in body) task.due = isDateLike(body.due) ? str(body.due) : undefined;
    if ("note" in body) task.note = str(body.note, "", 500) || undefined;
    const previousMembers=JSON.stringify(task.memberIds||[]);
    task.memberIds=memberIds(s,"memberIds" in body?body.memberIds:task.memberIds||[],task.department);
    task.organization=organizationFor(task.department,s.settings);
    task.matterId=validateMatter(s,"matterId" in body?body.matterId:task.matterId,task.department);
    if(previousMembers!==JSON.stringify(task.memberIds)&&task.status==="done"&&!("volunteerHours" in body)){assert(body.status!=="done","执行成员已变更，请重新确认志愿时");task.status="review";}
    task.assignee=(task.memberIds||[]).map(id=>s.members.find(m=>m.id===id)?.name).filter(Boolean).join("、")||task.assignee;
    if(task.department==="运营部"&&"volunteerHours" in body){
      assert(task.status==="done","请先通过审批，再确认志愿时");
      assert(task.memberIds?.length,"请至少选择一位执行成员");
      assert(body.volunteerHours&&typeof body.volunteerHours==="object"&&!Array.isArray(body.volunteerHours),"请填写各执行成员的志愿时");
      const hours:Record<string,number>={};
      for(const [id,value] of Object.entries(body.volunteerHours)){assert(task.memberIds.includes(id),"志愿时只能登记给执行成员");assert(typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1000,"志愿时须为 0–1000 小时");hours[id]=Math.round(value*100)/100;}
      assert(task.memberIds.every(id=>id in hours),"请填写每位执行成员的志愿时，无时长填写 0");task.volunteerHours=hours;task.volunteerEntered=body.volunteerEntered===true;
    }
    if(task.department==="运营部"&&body.status==="done"&&previousStatus!=="done"&&!("volunteerHours" in body)){
      assert(task.volunteerHours&&task.memberIds?.length&&task.memberIds.every(id=>typeof task.volunteerHours?.[id]==="number"),"通过前请确认每位执行成员的志愿时");
    }
    if("volunteerEntered" in body){assert(task.department==="运营部"&&task.status==="done"&&task.volunteerHours,"仅已通过并确认志愿时的任务可以标记录入");task.volunteerEntered=body.volunteerEntered===true;}
    if(task.status==="done"&&!task.approvedAt)task.approvedAt=nowISO();
    if(task.status!=="done"){task.approvedAt=undefined;task.volunteerEntered=false;task.volunteerHours=undefined;}
    task.updatedAt = nowISO();
    return task;
  });
  return json({ task: result });
}

export async function deleteTask(ctx: Ctx) {
  await mutateStore((s) => {
    const idx = s.tasks.findIndex((t) => t.id === ctx.params.id);
    if (idx < 0) throw new AppError("任务不存在", 404);
    s.tasks.splice(idx, 1);
  });
  return json({ ok: true });
}

export { TAGS };

function safeLink(value: unknown) {
  const raw = str(value, "", 2000).trim();
  if (!raw) return "";
  try { const url = new URL(raw); assert(["https:", "http:"].includes(url.protocol), "链接须以 http 或 https 开头"); return url.href; }
  catch { throw new AppError("请输入有效的 http 或 https 链接", 400); }
}

function validateMatter(s:Store,value:unknown,department:string){const id=str(value,"",100);if(!id)return undefined;const matter=s.matters.find(m=>m.id===id);assert(matter&&matter.department===department,"子任务必须归入当前部门的事务");return id;}
