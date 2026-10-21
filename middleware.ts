import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const policy = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' https:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"].join("; ");
  const headers = new Headers(req.headers); headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } }); res.headers.set("Content-Security-Policy", policy);
  res.headers.set("X-Content-Type-Options", "nosniff"); res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin"); res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Cache-Control", "private, no-store");
  if (process.env.WORKBENCH_PUBLIC_URL?.startsWith("https://")) res.headers.set("Strict-Transport-Security", "max-age=31536000");
  return res;
}
export const config = { matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)"] };
