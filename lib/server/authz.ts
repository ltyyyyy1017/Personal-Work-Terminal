import type { NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE, hashToken } from "../../lib/auth";
import { mutateStore, readStore, nowISO } from "../../lib/store";
import type { ApiToken, Store } from "../../lib/types";

export function sessionValid(req: NextRequest): boolean {
  return readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export function bearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

export function findToken(store: Store, raw: string): ApiToken | undefined {
  const hash = hashToken(raw);
  return store.tokens.find((t) => t.hash === hash);
}

let lastTouch = 0;

export function touchToken(id: string) {
  const now = Date.now();
  if (now - lastTouch < 60_000) return;
  lastTouch = now;
  void mutateStore((store) => {
    const token = store.tokens.find((t) => t.id === id);
    if (token) token.lastUsedAt = nowISO();
  }).catch(() => undefined);
}

export function tokenValid(req: NextRequest): { token: ApiToken; store: Store } | null {
  const raw = bearer(req);
  if (!raw) return null;
  const store = readStore();
  const token = findToken(store, raw);
  if (!token) return null;
  touchToken(token.id);
  return { token, store };
}

export function anyValid(req: NextRequest): { store: Store; via: "session" | "token" } | null {
  if (sessionValid(req)) return { store: readStore(), via: "session" };
  const t = tokenValid(req);
  if (t) return { store: t.store, via: "token" };
  return null;
}
