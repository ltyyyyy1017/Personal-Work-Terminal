import { PDFDocument, PageSizes } from "pdf-lib";
import { extractText } from "unpdf";
import { AppError } from "./errors";
import sharp from "sharp";

const MARGIN = 26;

export function isPdfBytes(buf: Uint8Array | Buffer): boolean {
  return (
    buf.length > 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  );
}

/** 图片转 A4 PDF：等比缩放并居中，横向图片自动使用横向纸 */
export async function imageToPdf(
  buf: Uint8Array | Buffer,
  mime: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let image;
  try {
    if (/png/i.test(mime)) {
      image = await doc.embedPng(buf);
    } else if (/jpe?g/i.test(mime)) {
      image = await doc.embedJpg(buf);
    } else if (/webp/i.test(mime)) {
      image = await doc.embedPng(await sharp(buf).rotate().png().toBuffer());
    } else {
      throw new AppError(
        "暂不支持该图片格式，请使用 JPG、PNG 或 WebP；HEIC 请先导出为 JPG",
        415,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("图片解析失败，可能已损坏或格式不受支持", 422);
  }

  const landscape = image.width > image.height;
  const [pw, ph] = landscape
    ? [PageSizes.A4[1], PageSizes.A4[0]]
    : [PageSizes.A4[0], PageSizes.A4[1]];
  const page = doc.addPage([pw, ph]);
  const maxW = pw - MARGIN * 2;
  const maxH = ph - MARGIN * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1.8);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: (pw - w) / 2,
    y: (ph - h) / 2,
    width: w,
    height: h,
  });
  const bytes = await doc.save();
  return bytes;
}

export async function normalizeToPdf(
  buf: Uint8Array | Buffer,
  mime: string,
  fileName: string,
): Promise<{ bytes: Uint8Array; converted: boolean }> {
  if (isPdfBytes(buf) || /pdf/i.test(mime) || /\.pdf$/i.test(fileName)) {
    // 校验能被解析，避免把损坏文件塞进压缩包
    try {
      await PDFDocument.load(buf, { updateMetadata: false });
    } catch {
      throw new AppError(`「${fileName}」不是可读取的 PDF（可能已加密或损坏）`, 422);
    }
    return { bytes: new Uint8Array(buf), converted: false };
  }
  if (/^image\/(png|jpe?g|webp)/i.test(mime)) {
    return { bytes: await imageToPdf(buf, mime), converted: true };
  }
  throw new AppError(
    `「${fileName}」格式暂不支持自动转 PDF，请上传 PDF / JPG / PNG`,
    415,
  );
}

export async function mergePdfs(list: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

export interface PdfReadResult {
  pages: number;
  text: string;
  ok: boolean;
}

export async function readPdf(
  buf: Uint8Array | Buffer,
): Promise<PdfReadResult> {
  try {
    const { totalPages, text } = await extractText(new Uint8Array(buf), {
      mergePages: true,
    });
    return { pages: totalPages, text, ok: true };
  } catch (err) {
    console.warn("[pdf] 文本抽取失败", (err as Error)?.message);
    return { pages: 0, text: "", ok: false };
  }
}

export function humanSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
