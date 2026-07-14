// 小T「风格锚定」按钮 + 轻量弹层：风格参考图（资产库）+ 风格描述。
// 自持状态直接读写 aiChatStore（xiaotStyleAnchor，会话级不 persist）。
// 风格参考图走「从资产库选择」→ 唤起居中素材库弹窗（复用 LibraryPanel 的 modal + 单选变体，
// 三 tab：个人库/团队库/项目库），选中一张图即回填参考图。
import React, { useEffect, useState } from "react";
import { Palette, Check, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import SmartImage from "@/components/ui/SmartImage";
import LibraryPanel from "@/components/panels/LibraryPanel";
import { useAIChatStore } from "@/stores/aiChatStore";

interface Props {
  isBlackTheme: boolean;
  disabled?: boolean;
  dropdownSide?: "top" | "bottom" | "left" | "right";
  lt: (zh: string, en: string) => string;
}

export default function XiaotStyleAnchorButton({
  isBlackTheme,
  disabled,
  dropdownSide = "top",
  lt,
}: Props) {
  const anchor = useAIChatStore((s) => s.xiaotStyleAnchor);
  const setAnchor = useAIChatStore((s) => s.setXiaotStyleAnchor);
  const clearAnchor = useAIChatStore((s) => s.clearXiaotStyleAnchor);

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [assetName, setAssetName] = useState<string | undefined>(undefined);

  // 素材库弹窗（居中单选选择器）显隐
  const [libraryOpen, setLibraryOpen] = useState(false);

  const isActive = Boolean(
    anchor && (anchor.description.trim() || anchor.imageUrl)
  );

  // 打开弹层时以当前 store 值填充草稿
  useEffect(() => {
    if (open) {
      setDescription(anchor?.description ?? "");
      setImageUrl(anchor?.imageUrl);
      setAssetName(anchor?.assetName);
      setLibraryOpen(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 从素材库弹窗选中一张图：更新草稿，并立即提交到 store。
  // （唤起弹窗后点击图片会落在 dropdown 外部导致其关闭，直接提交可避免草稿丢失。）
  const handleSelectFromLibrary = (url: string, name?: string) => {
    setImageUrl(url);
    setAssetName(name);
    setAnchor({
      imageUrl: url,
      assetName: name,
      description: description.trim(),
    });
    setLibraryOpen(false);
  };

  const handleDone = () => {
    const hasContent = description.trim() || imageUrl;
    if (hasContent) {
      setAnchor({
        imageUrl,
        assetName,
        description: description.trim(),
      });
    } else {
      clearAnchor();
    }
    setOpen(false);
  };

  const handleClear = () => {
    clearAnchor();
    setDescription("");
    setImageUrl(undefined);
    setAssetName(undefined);
    setOpen(false);
  };

  return (
    <>
    <DropdownMenu
      className='relative dropdown-menu-root'
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          disabled={false}
          data-dropdown-trigger='true'
          className={cn(
            "h-7 pl-2 pr-2.5 flex select-none items-center gap-1 rounded-full text-xs transition-all duration-200",
            "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
            isActive
              ? isBlackTheme
                ? "bg-blue-600 text-white border-blue-500 hover:bg-blue-500"
                : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
              : !disabled
              ? isBlackTheme
                ? "text-gray-400 border-gray-600"
                : "hover:bg-gray-100 text-gray-700"
              : "opacity-50 cursor-not-allowed text-gray-400"
          )}
          title={lt("风格锚定（参考图 / 描述）", "Style anchor (reference / description)")}
        >
          <Palette className='h-3.5 w-3.5 shrink-0' />
          <span className='font-medium'>{lt("风格", "Style")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side={dropdownSide}
        sideOffset={8}
        className='dropdown-menu-root w-[300px] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-md'
      >
        <div className='space-y-3 text-xs'>
          {/* 风格参考图 */}
          <div>
            <div className='mb-1 font-medium text-slate-700'>
              {lt("风格参考图", "Style reference")}
            </div>
            {imageUrl ? (
              <div className='flex items-center gap-2'>
                <SmartImage
                  src={imageUrl}
                  alt={assetName || "style"}
                  className='h-10 w-10 shrink-0 rounded object-cover'
                />
                <span className='min-w-0 flex-1 truncate text-slate-500'>
                  {assetName || imageUrl}
                </span>
                <button
                  type='button'
                  className='shrink-0 rounded p-1 text-slate-400 hover:bg-gray-100 hover:text-slate-700'
                  title={lt("移除", "Remove")}
                  onClick={() => {
                    setImageUrl(undefined);
                    setAssetName(undefined);
                  }}
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              </div>
            ) : (
              <button
                type='button'
                className='flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-2 text-slate-500 hover:bg-gray-50'
                onClick={() => setLibraryOpen(true)}
              >
                <ImageIcon className='h-3.5 w-3.5' />
                {lt("从资产库选择", "Pick from library")}
              </button>
            )}
          </div>

          {/* 风格描述 */}
          <div>
            <div className='mb-1 font-medium text-slate-700'>
              {lt("风格描述", "Style description")}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={lt(
                "如：赛博朋克霓虹夜景、品红青色高对比",
                "e.g. cyberpunk neon night, magenta-cyan high contrast"
              )}
              className='w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400'
            />
          </div>

          {/* 底部操作 */}
          <div className='flex items-center justify-between border-t border-slate-100 pt-2'>
            <button
              type='button'
              className='rounded-md px-2 py-1 text-slate-500 hover:bg-gray-100'
              onClick={handleClear}
            >
              {lt("清除", "Clear")}
            </button>
            <button
              type='button'
              className='flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-800'
              onClick={handleDone}
            >
              <Check className='h-3.5 w-3.5' />
              {lt("完成", "Done")}
            </button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>

      {/* 居中素材库弹窗（单选风格参考图，复用 LibraryPanel 的 modal 变体） */}
      <LibraryPanel
        variant='modal'
        open={libraryOpen}
        selectMode
        onClose={() => setLibraryOpen(false)}
        onSelectAsset={handleSelectFromLibrary}
      />
    </>
  );
}
