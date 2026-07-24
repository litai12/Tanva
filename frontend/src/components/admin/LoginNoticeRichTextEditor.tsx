import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, ImagePlus, Italic, Palette, PaintBucket, RemoveFormatting, Type, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LOGIN_NOTICE_FONT_OPTIONS,
  LOGIN_NOTICE_MAX_TEXT_LENGTH,
  loginNoticeHtmlToText,
  sanitizeLoginNoticeHtml,
} from "@/utils/loginNoticeRichText";

const FONT_SIZE_OPTIONS = [
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
  { label: "28", value: "28px" },
  { label: "32", value: "32px" },
];

type LoginNoticeRichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  maxLength?: number;
};

const toolbarButtonClass =
  "h-8 w-8 rounded-md border border-gray-200 bg-white p-0 text-gray-700 hover:bg-gray-50";

export default function LoginNoticeRichTextEditor({
  value,
  onChange,
  disabled = false,
  maxLength = LOGIN_NOTICE_MAX_TEXT_LENGTH,
}: LoginNoticeRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const lastEmittedHtmlRef = useRef("");
  const [textLength, setTextLength] = useState(() => loginNoticeHtmlToText(value).length);
  const [uploadingImage, setUploadingImage] = useState(false);
  const isOverLimit = textLength > maxLength;

  const sanitizedValue = useMemo(() => sanitizeLoginNoticeHtml(value), [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lastEmittedHtmlRef.current === sanitizedValue) return;
    if (editor.innerHTML === sanitizedValue) return;
    editor.innerHTML = sanitizedValue;
    lastEmittedHtmlRef.current = sanitizedValue;
    setTextLength(loginNoticeHtmlToText(sanitizedValue).length);
  }, [sanitizedValue]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = sanitizeLoginNoticeHtml(editor.innerHTML);
    lastEmittedHtmlRef.current = nextHtml;
    setTextLength(loginNoticeHtmlToText(nextHtml).length);
    onChange(nextHtml);
  };

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const runCommand = (command: string, commandValue?: string) => {
    if (disabled) return;
    focusEditor();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, commandValue);
    emitChange();
  };

  const selectionBelongsToEditor = (range: Range) => {
    const editor = editorRef.current;
    if (!editor) return false;
    const container = range.commonAncestorContainer;
    return editor.contains(container.nodeType === Node.ELEMENT_NODE ? container : container.parentNode);
  };

  const applyInlineStyle = (styles: Partial<CSSStyleDeclaration>) => {
    if (disabled) return;
    focusEditor();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed || !selectionBelongsToEditor(range)) return;

    const span = document.createElement("span");
    Object.assign(span.style, styles);
    span.appendChild(range.extractContents());
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    emitChange();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
    window.requestAnimationFrame(emitChange);
  };

  const handleImageUpload = async (file: File) => {
    if (disabled || !file.type.startsWith("image/")) return;
    setUploadingImage(true);
    try {
      const { uploadToOSS } = await import("@/services/ossUploadService");
      const result = await uploadToOSS(file, {
        dir: "settings/login-notices/content/",
        fileName: file.name,
      });
      if (!result.success || !result.url) throw new Error(result.error || "图片上传失败");
      focusEditor();
      document.execCommand(
        "insertHTML",
        false,
        `<img src="${result.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" alt="" />`
      );
      emitChange();
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div className='rounded-lg border border-gray-200 bg-white'>
      <div className='flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/80 px-3 py-2'>
        <Button
          type='button'
          variant='outline'
          className={toolbarButtonClass}
          onClick={() => runCommand("bold")}
          disabled={disabled}
          title='加粗'
        >
          <Bold className='h-4 w-4' />
        </Button>
        <input
          ref={imageInputRef}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImageUpload(file);
            event.target.value = "";
          }}
        />
        <Button
          type='button'
          variant='outline'
          className='h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50'
          onClick={() => imageInputRef.current?.click()}
          disabled={disabled || uploadingImage}
          title='插入正文图片'
        >
          <ImagePlus className='mr-1 h-3.5 w-3.5' />
          {uploadingImage ? "上传中" : "图片"}
        </Button>
        <Button
          type='button'
          variant='outline'
          className={toolbarButtonClass}
          onClick={() => runCommand("italic")}
          disabled={disabled}
          title='斜体'
        >
          <Italic className='h-4 w-4' />
        </Button>
        <Button
          type='button'
          variant='outline'
          className={toolbarButtonClass}
          onClick={() => runCommand("underline")}
          disabled={disabled}
          title='下划线'
        >
          <Underline className='h-4 w-4' />
        </Button>

        <div className='mx-1 h-5 w-px bg-gray-200' />

        <label className='flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600'>
          <Type className='h-3.5 w-3.5' />
          <select
            className='bg-transparent text-xs outline-none'
            disabled={disabled}
            defaultValue=''
            onChange={(event) => {
              const font = LOGIN_NOTICE_FONT_OPTIONS.find((item) => item.value === event.target.value);
              if (font?.css) applyInlineStyle({ fontFamily: font.css });
              event.target.value = "";
            }}
          >
            {LOGIN_NOTICE_FONT_OPTIONS.map((font) => (
              <option key={font.value || "default"} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>

        <select
          className='h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none'
          disabled={disabled}
          defaultValue=''
          onChange={(event) => {
            if (event.target.value) applyInlineStyle({ fontSize: event.target.value });
            event.target.value = "";
          }}
          title='字号'
        >
          <option value=''>字号</option>
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}px
            </option>
          ))}
        </select>

        <label className='flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600' title='文字颜色'>
          <Palette className='h-3.5 w-3.5' />
          <input
            type='color'
            className='h-5 w-6 cursor-pointer border-0 bg-transparent p-0'
            disabled={disabled}
            defaultValue='#1677ff'
            onChange={(event) => applyInlineStyle({ color: event.target.value })}
          />
        </label>

        <label className='flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600' title='背景色'>
          <PaintBucket className='h-3.5 w-3.5' />
          <input
            type='color'
            className='h-5 w-6 cursor-pointer border-0 bg-transparent p-0'
            disabled={disabled}
            defaultValue='#fff3bf'
            onChange={(event) => applyInlineStyle({ backgroundColor: event.target.value })}
          />
        </label>

        <Button
          type='button'
          variant='outline'
          className='h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50'
          onClick={() => runCommand("removeFormat")}
          disabled={disabled}
          title='清除格式'
        >
          <RemoveFormatting className='mr-1 h-3.5 w-3.5' />
          清除
        </Button>
      </div>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        className='min-h-[220px] w-full overflow-y-auto px-4 py-3 text-sm leading-7 text-gray-800 outline-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]'
        data-placeholder='请输入用户登录后需要看到的提醒内容'
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={handlePaste}
      />

      <div className='flex justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-400'>
        <span>支持文字样式和正文图片；图片上传后保存为远程 URL。</span>
        <span className={isOverLimit ? "text-red-500" : undefined}>
          {textLength}/{maxLength}
        </span>
      </div>
    </div>
  );
}
