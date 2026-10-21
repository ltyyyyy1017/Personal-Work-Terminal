import { AppError } from "./errors";
/** Windows Notepad exports may use UTF-8, UTF-16 or legacy Chinese encodings. */
export function decodePlainText(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > 1024 * 1024) throw new AppError("TXT 文件须为非空文本，大小不超过 1 MB", 400);
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    const sample = bytes.subarray(0, 200);
    const even = [...sample].filter((b, i) => i % 2 === 0 && b === 0).length;
    const odd = [...sample].filter((b, i) => i % 2 === 1 && b === 0).length;
    if (odd > sample.length / 8) encoding = "utf-16le";
    else if (even > sample.length / 8) encoding = "utf-16be";
    else { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { encoding = "gb18030"; } }
  }
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); }
  catch { throw new AppError("TXT 编码无法识别，请另存为 UTF-8 文本", 400); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || !text.trim()) throw new AppError("TXT 中没有可读取的文字，请上传文本文件", 400);
  return text;
}
