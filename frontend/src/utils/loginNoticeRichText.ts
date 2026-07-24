export const LOGIN_NOTICE_MAX_TEXT_LENGTH = 2000;

export type LoginNoticeFontOption = {
  label: string;
  value: string;
  css: string;
};

export const LOGIN_NOTICE_FONT_OPTIONS: LoginNoticeFontOption[] = [
  { label: "默认", value: "", css: "" },
  { label: "系统黑体", value: "system", css: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif" },
  { label: "苹方", value: "pingfang", css: "\"PingFang SC\", \"Microsoft YaHei\", sans-serif" },
  { label: "微软雅黑", value: "microsoft-yahei", css: "\"Microsoft YaHei\", \"PingFang SC\", sans-serif" },
  { label: "宋体", value: "simsun", css: "SimSun, \"Songti SC\", serif" },
  { label: "等宽", value: "mono", css: "\"Courier New\", ui-monospace, SFMono-Regular, Menlo, monospace" },
];

const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "video",
  "audio",
  "canvas",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
]);

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "span",
  "ul",
  "ol",
  "li",
  "img",
]);

const FONT_SIZE_BY_COMMAND: Record<string, string> = {
  "1": "12px",
  "2": "14px",
  "3": "16px",
  "4": "18px",
  "5": "24px",
  "6": "32px",
  "7": "40px",
};

const FONT_CSS_BY_NORMALIZED_NAME = new Map<string, string>();
for (const option of LOGIN_NOTICE_FONT_OPTIONS) {
  if (!option.css) continue;
  const names = option.css
    .split(",")
    .map((item) => item.replace(/["']/g, "").trim().toLowerCase())
    .filter(Boolean);
  for (const name of names) {
    FONT_CSS_BY_NORMALIZED_NAME.set(name, option.css);
  }
}

const hasDomParser = () =>
  typeof window !== "undefined" &&
  typeof DOMParser !== "undefined" &&
  typeof document !== "undefined";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeTagName = (tagName: string) => {
  const lower = tagName.toLowerCase();
  if (lower === "div") return "p";
  if (lower === "b") return "strong";
  if (lower === "i") return "em";
  if (lower === "font") return "span";
  return lower;
};

const sanitizeCssColor = (value: string | null | undefined) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  if (
    /^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }
  return "";
};

const sanitizeFontSize = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";
  const px = trimmed.match(/^(\d{1,2})px$/);
  if (px) {
    const size = Number(px[1]);
    return size >= 10 && size <= 56 ? `${size}px` : "";
  }
  const rem = trimmed.match(/^(\d(?:\.\d{1,2})?)rem$/);
  if (rem) {
    const size = Number(rem[1]);
    return size >= 0.7 && size <= 3.5 ? `${size}rem` : "";
  }
  return "";
};

const sanitizeFontWeight = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed === "bold" || trimmed === "normal") return trimmed;
  if (/^[1-9]00$/.test(trimmed)) {
    const weight = Number(trimmed);
    return weight >= 300 && weight <= 900 ? trimmed : "";
  }
  return "";
};

const sanitizeTextDecoration = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.includes("underline") ? "underline" : "";
};

const sanitizeTextAlign = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  return ["left", "center", "right"].includes(trimmed) ? trimmed : "";
};

const sanitizeLineHeight = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";
  if (/^(?:1|1\.\d{1,2}|2|2\.\d{1,2})$/.test(trimmed)) return trimmed;
  const px = trimmed.match(/^(\d{1,2})px$/);
  if (px) {
    const size = Number(px[1]);
    return size >= 12 && size <= 64 ? `${size}px` : "";
  }
  return "";
};

const sanitizeSpacing = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";
  const px = trimmed.match(/^(\d{1,2})px$/);
  if (px) {
    const size = Number(px[1]);
    return size >= 0 && size <= 48 ? `${size}px` : "";
  }
  return "";
};

const sanitizeFontFamily = (value: string | null | undefined) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const firstName = trimmed.split(",")[0]?.replace(/["']/g, "").trim().toLowerCase();
  if (!firstName) return "";
  return FONT_CSS_BY_NORMALIZED_NAME.get(firstName) || "";
};

const getElementStyles = (element: Element, outputTagName: string) => {
  const htmlElement = element as HTMLElement;
  const sourceStyle = htmlElement.style;
  const styles: string[] = [];

  const color = sanitizeCssColor(sourceStyle.color || element.getAttribute("color"));
  if (color) styles.push(`color: ${color}`);

  const backgroundColor = sanitizeCssColor(sourceStyle.backgroundColor || sourceStyle.background);
  if (backgroundColor) styles.push(`background-color: ${backgroundColor}`);

  const commandSize = element.getAttribute("size");
  const fontSize =
    sanitizeFontSize(sourceStyle.fontSize) ||
    (commandSize ? FONT_SIZE_BY_COMMAND[commandSize] || "" : "");
  if (fontSize) styles.push(`font-size: ${fontSize}`);

  const fontWeight = sanitizeFontWeight(sourceStyle.fontWeight);
  if (fontWeight) styles.push(`font-weight: ${fontWeight}`);

  const textDecoration = sanitizeTextDecoration(
    sourceStyle.textDecorationLine || sourceStyle.textDecoration
  );
  if (textDecoration) styles.push(`text-decoration: ${textDecoration}`);

  const fontFamily = sanitizeFontFamily(sourceStyle.fontFamily || element.getAttribute("face"));
  if (fontFamily) styles.push(`font-family: ${fontFamily}`);

  const lineHeight = sanitizeLineHeight(sourceStyle.lineHeight);
  if (lineHeight) styles.push(`line-height: ${lineHeight}`);

  if (outputTagName === "p" || outputTagName === "li") {
    const textAlign = sanitizeTextAlign(sourceStyle.textAlign);
    if (textAlign) styles.push(`text-align: ${textAlign}`);
    const marginTop = sanitizeSpacing(sourceStyle.marginTop);
    if (marginTop) styles.push(`margin-top: ${marginTop}`);
    const marginBottom = sanitizeSpacing(sourceStyle.marginBottom);
    if (marginBottom) styles.push(`margin-bottom: ${marginBottom}`);
  }

  return styles.join("; ");
};

const appendSanitizedNode = (source: Node, target: Node) => {
  if (source.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(source.textContent || ""));
    return;
  }

  if (source.nodeType !== Node.ELEMENT_NODE) return;

  const sourceElement = source as Element;
  const rawTagName = sourceElement.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(rawTagName)) return;

  const tagName = normalizeTagName(rawTagName);
  if (!ALLOWED_TAGS.has(tagName)) {
    source.childNodes.forEach((child) => appendSanitizedNode(child, target));
    return;
  }

  const cleanElement = document.createElement(tagName);
  if (tagName === "img") {
    const src = (sourceElement.getAttribute("src") || "").trim();
    if (!/^(?:https?:\/\/|\/)/i.test(src)) return;
    cleanElement.setAttribute("src", src);
    cleanElement.setAttribute("alt", (sourceElement.getAttribute("alt") || "").slice(0, 200));
    cleanElement.setAttribute("loading", "lazy");
    cleanElement.setAttribute("style", "display: block; max-width: 100%; height: auto; margin: 12px auto");
    target.appendChild(cleanElement);
    return;
  }
  if (tagName !== "br") {
    const cssText = getElementStyles(sourceElement, tagName);
    if (cssText) cleanElement.setAttribute("style", cssText);
    source.childNodes.forEach((child) => appendSanitizedNode(child, cleanElement));
  }
  target.appendChild(cleanElement);
};

export function sanitizeLoginNoticeHtml(html: string): string {
  if (!html.trim()) return "";
  if (!hasDomParser()) {
    return escapeHtml(html).replace(/\r\n?|\n/g, "<br>");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const output = document.createElement("div");
  doc.body.firstElementChild?.childNodes.forEach((child) => {
    appendSanitizedNode(child, output);
  });
  return output.innerHTML.trim();
}

export function plainTextToLoginNoticeHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").slice(0, LOGIN_NOTICE_MAX_TEXT_LENGTH);
  return sanitizeLoginNoticeHtml(escapeHtml(normalized).replace(/\n/g, "<br>"));
}

export function loginNoticeHtmlToText(html: string): string {
  if (!html.trim()) return "";
  if (!hasDomParser()) {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${sanitizeLoginNoticeHtml(html)}</div>`, "text/html");
  doc.body.querySelectorAll("br").forEach((br) => {
    br.replaceWith(doc.createTextNode("\n"));
  });
  doc.body.querySelectorAll("p,div,li").forEach((element) => {
    element.appendChild(doc.createTextNode("\n"));
  });
  return (doc.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
