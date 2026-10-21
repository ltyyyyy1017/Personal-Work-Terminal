import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.WORKBENCH_STANDALONE === "true" ? "standalone" : undefined,
  serverExternalPackages: ["unpdf", "pdfjs-dist", "exceljs", "jszip", "tesseract.js", "@napi-rs/canvas"],
  outputFileTracingIncludes: { "/*": ["./node_modules/tesseract.js/**/*", "./node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/**/*", "./node_modules/@tesseract.js-data/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./runtime/**/*", "**/workbench-ocr-models-v1/**/*"] },
  experimental: {
    ...(process.env.WORKBENCH_BUILD_CPUS ? { cpus: Number(process.env.WORKBENCH_BUILD_CPUS) || 1 } : {}),
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
