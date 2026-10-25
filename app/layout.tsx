import "./local-work.css";
import type { Metadata } from "next";
import "./globals.css";
import "./upgrade.css";
import "./member-avatar.css";
import "./dialog.css";
import "./workspaces.css";
import "./liquid-glass.css";
import "./account.css";
import "./refinement.css";
import "./reimbursement-upload.css";
import "./macos.css";
import "./desktop-polish.css";
import LiquidGlass from "@/components/liquid-glass";
export const metadata: Metadata = { title: "个人工作台", description: "设备事务、部员对接与日常工作，在这里有序推进。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><LiquidGlass/>{children}</body></html>;
}
