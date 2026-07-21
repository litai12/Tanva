// frontend/src/utils/documentTextExtract.ts
// 文档 → 纯文本提取：AI 对话框拖拽/上传 txt、md、docx 时把正文抽出来当文本输入。
// 与 PDF 链路不同：PDF 是传 OSS 给模型做多模态分析（setSourcePdfForAnalysis），
// 这里是本地提取文本直接填进输入框，不联网、不上传、不扣费。

/** 文件选择框 accept：MIME + 扩展名双写（部分系统对 .md/.docx 给不出 MIME） */
export const DOC_TEXT_ACCEPT =
  ".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 单文件体积上限：10MB */
export const DOC_MAX_FILE_SIZE = 10 * 1024 * 1024;
/**
 * 提取文本的体积上限：10MB（按 UTF-8 字节计，与文件上限同口径），超出截断并提示。
 * 不是走过场的重复限制——txt 的文件大小≈文本大小，但 **docx 是 zip 压缩的 XML**，
 * 10MB 的 docx 解压后可能吐出几十 MB 文本，这道才真正兜得住。
 */
export const DOC_MAX_TEXT_BYTES = 10 * 1024 * 1024;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type DocKind = "text" | "docx";

/**
 * 判定文件类型。**以扩展名为准**：浏览器给的 file.type 对 .md 常是空串、
 * 对 .docx 在部分系统上是 application/zip，只信 MIME 会漏判。
 */
export function detectDocKind(file: File): DocKind | null {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    return "text";
  }
  // 扩展名缺失时退回 MIME（如从其他应用拖来的无名文本流）
  if (file.type === DOCX_MIME) return "docx";
  if (file.type.startsWith("text/")) return "text";
  return null;
}

export function isSupportedDocFile(file: File): boolean {
  return detectDocKind(file) !== null;
}

/**
 * 解码纯文本字节流。先认 BOM，再试 UTF-8（fatal，遇非法字节即抛），
 * 失败回落 GB18030——国内 .txt 大量是 GBK/GB18030，直接按 UTF-8 解会得到一片乱码。
 */
function decodeTextBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      // 连 GB18030 都不认（极老浏览器无此编码）→ 宽松 UTF-8，宁可局部乱码也别丢文件
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

/**
 * docx 提取。mammoth 体积大（含 jszip/xmldom），**必须动态 import**：
 * 只有用户真的拖进 docx 时才拉这个 chunk，不进主包。
 * （项目主包已做过 7.5MB→4.6MB 拆分，新重依赖一律 lazy。）
 * mammoth 的 package.json browser 字段会把 unzip/files 换成浏览器实现，
 * lib/main.js（唯一另一处 require fs/os）只被 CLI 引用、不在 index.js 依赖图内。
 */
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

/** 归一空白：docx 抽出的段落常带大量空行；统一换行符并压掉 3+ 连续空行 */
function normalizeExtracted(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 文本的 UTF-8 字节数 */
export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 按 UTF-8 字节上限截断，且不切断多字节字符——中文一刀切在半个字上会留下 U+FFFD（�）。
 * 做法：切到上限字节后解码（非 fatal，尾部残缺字节变 �），再剥掉尾部的 �。
 * 调用方：单文件提取（本文件）+ 多文件累计闸门（AIChatDialog ingestDocFiles）。
 */
export function fitTextToBytes(
  text: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: true };
  return truncateToBytes(text, maxBytes);
}

function truncateToBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const decoded = new TextDecoder("utf-8").decode(bytes.subarray(0, maxBytes));
  return { text: decoded.replace(/�+$/, ""), truncated: true };
}

export interface DocExtractResult {
  fileName: string;
  text: string;
  /** 是否因超过 DOC_MAX_TEXT_BYTES 被截断 */
  truncated: boolean;
  /** 提取到的原始字符数（截断前） */
  charCount: number;
  /** 提取到的原始 UTF-8 字节数（截断前） */
  byteCount: number;
}

export class DocExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocExtractError";
  }
}

/**
 * 单个文件 → 文本。失败抛 DocExtractError（消息可直接给用户看）。
 * 不做上传、不发网络请求，纯本地解析。
 */
export async function extractTextFromDocFile(file: File): Promise<DocExtractResult> {
  const kind = detectDocKind(file);
  if (!kind) {
    throw new DocExtractError(`不支持的文件类型：${file.name || "未命名文件"}`);
  }
  if (file.size > DOC_MAX_FILE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new DocExtractError(
      `${file.name} 过大（${mb}MB），最大支持 ${DOC_MAX_FILE_SIZE / 1024 / 1024}MB`
    );
  }
  if (file.size === 0) {
    throw new DocExtractError(`${file.name} 是空文件`);
  }

  let raw: string;
  try {
    raw = kind === "docx" ? await extractDocxText(file) : decodeTextBytes(await file.arrayBuffer());
  } catch (error) {
    console.error("[documentTextExtract] 解析失败:", file.name, error);
    // docx 损坏 / 实为 .doc 改名 / 加密 → mammoth 抛错，给用户可行动的话
    throw new DocExtractError(
      kind === "docx"
        ? `${file.name} 解析失败：可能是旧版 .doc（请另存为 .docx）或文件已损坏/加密`
        : `${file.name} 读取失败`
    );
  }

  const normalized = normalizeExtracted(raw);
  if (!normalized) {
    throw new DocExtractError(`${file.name} 没有可提取的文字内容`);
  }
  const { text, truncated } = truncateToBytes(normalized, DOC_MAX_TEXT_BYTES);
  return {
    fileName: file.name || "未命名文件",
    text,
    truncated,
    charCount: normalized.length,
    byteCount: textByteLength(normalized),
  };
}

/** 从拖拽/选择的文件列表里挑出支持的文档（其余交由调用方提示） */
export function pickSupportedDocFiles(files: FileList | File[]): {
  supported: File[];
  rejected: File[];
} {
  const list = Array.from(files);
  const supported: File[] = [];
  const rejected: File[] = [];
  for (const f of list) (isSupportedDocFile(f) ? supported : rejected).push(f);
  return { supported, rejected };
}
