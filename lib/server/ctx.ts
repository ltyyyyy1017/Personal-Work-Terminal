import type { NextRequest } from "next/server";

export interface Ctx {
  req: NextRequest;
  url: URL;
  path: string[];
  params: Record<string, string>;
  body: <T = Record<string, unknown>>() => Promise<T>;
  form: () => Promise<FormData>;
}
