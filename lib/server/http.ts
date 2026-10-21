import { NextResponse } from "next/server";
import { AppError } from "../../lib/errors";
import crypto from "node:crypto";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return json({ error: err.message }, err.status);
  }
  const id = crypto.randomUUID().slice(0, 8);
  console.error(`[api:${id}]`, err);
  return json({ error: `服务器内部错误（错误编号 ${id}）` }, 500);
}

export function str(value: unknown, fallback = "", max = 2000): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, max);
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && n < 0) throw new AppError("金额不能为负数", 400);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function isDateLike(value: unknown): value is string {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) return false;
  const [year,month,day,hour=0,minute=0]=value.split(/[-T:]/).map(Number);
  const date=new Date(year,month-1,day,hour,minute);
  return date.getFullYear()===year && date.getMonth()===month-1 && date.getDate()===day && date.getHours()===hour && date.getMinutes()===minute;
}
