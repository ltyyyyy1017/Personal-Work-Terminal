/** 全站统一使用「本地朴素时间」字符串：YYYY-MM-DDTHH:mm / YYYY-MM-DD */

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toLocalISO(d: Date): string {
  return `${toDateStr(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseLocal(input: string): Date {
  const m = input.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/,
  );
  if (!m) return new Date(input);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
  );
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function addDays(dateStr: string, n: number): string {
  const d = parseLocal(dateStr.slice(0, 10));
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function startOfWeek(dateStr: string, weekStart = 1): string {
  const d = parseLocal(dateStr.slice(0, 10));
  const day = d.getDay();
  const diff = weekStart === 1 ? (day === 0 ? -6 : 1 - day) : -day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayCN(dateStr: string): string {
  return WEEKDAYS[parseLocal(dateStr.slice(0, 10)).getDay()];
}

export function fmtDateCN(input?: string | null, withWeek = true): string {
  if (!input) return "";
  const d = parseLocal(input);
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeek ? `${base} ${WEEKDAYS[d.getDay()]}` : base;
}

export function fmtDateFull(input?: string | null): string {
  if (!input) return "";
  const d = parseLocal(input);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtTime(input?: string | null): string {
  if (!input) return "";
  const d = parseLocal(input);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDateTime(input?: string | null): string {
  if (!input) return "";
  return `${fmtDateCN(input)} ${fmtTime(input)}`;
}

export function timeRange(
  start?: string,
  end?: string,
  allDay?: boolean,
): string {
  if (allDay) return "全天";
  if (!start) return "";
  const s = fmtTime(start);
  if (!end) return s;
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay ? `${s} – ${fmtTime(end)}` : `${s} – ${fmtDateCN(end)} ${fmtTime(end)}`;
}

export function relativeDate(input?: string | null): string {
  if (!input) return "";
  const now = new Date();
  const then = parseLocal(input);
  const diffMs = now.getTime() - then.getTime();
  const dayMs = 86400000;
  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      dayMs,
  );
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays === 2) return "前天";
  if (diffDays > 0 && diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 0 && diffDays > -7) return `${-diffDays} 天后`;
  if (Math.abs(diffMs) < 60000) return "刚刚";
  return `${then.getMonth() + 1}/${then.getDate()}`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export interface GridDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  weekday: number;
}

export function monthGrid(year: number, month0: number, weekStart = 1): GridDay[] {
  const first = new Date(year, month0, 1);
  const offset =
    weekStart === 1 ? (first.getDay() === 0 ? 6 : first.getDay() - 1) : first.getDay();
  const start = new Date(year, month0, 1 - offset);
  const today = todayStr();
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({
      date: toDateStr(d),
      inMonth: d.getMonth() === month0,
      isToday: toDateStr(d) === today,
      weekday: d.getDay(),
    });
  }
  return days;
}

export function monthLabel(year: number, month0: number): string {
  return `${year} 年 ${month0 + 1} 月`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (parseLocal(b.slice(0, 10)).getTime() - parseLocal(a.slice(0, 10)).getTime()) / 86400000,
  );
}

export function isoWeekdayShort(dateStr: string): string {
  return WEEKDAYS[parseLocal(dateStr).getDay()].replace("周", "");
}
