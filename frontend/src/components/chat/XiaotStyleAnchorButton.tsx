// 小T统一设置：大脑、图片/视频模型、生成规格与风格锚定。
// 所有偏好直接读写 aiChatStore；风格参考图继续复用素材库单选弹窗。
import React, { useEffect, useState } from "react";
import { Check, ImageIcon, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import SmartImage from "@/components/ui/SmartImage";
import LibraryPanel from "@/components/panels/LibraryPanel";
import { useAIChatStore } from "@/stores/aiChatStore";
import type { XiaotChatModel } from "@/services/agentBackendAPI";
import {
  XIAOT_PREFERRED_IMAGE_MODELS,
  XIAOT_PREFERRED_VIDEO_MODELS,
} from "@/services/agentCanvasProtocol";

interface Props {
  isBlackTheme: boolean;
  disabled?: boolean;
  dropdownSide?: "top" | "bottom" | "left" | "right";
  lt: (zh: string, en: string) => string;
}

const BRAIN_OPTIONS: Array<{ label: string; value: XiaotChatModel }> = [
  { label: "Fast · GPT-5.4", value: "xiaot-agent-gpt-5-4" },
  { label: "Pro · GPT-5.5", value: "xiaot-agent-gpt-5-5" },
  { label: "Ultra · GPT-5.6 Luna", value: "xiaot-agent-gpt-5-6-luna" },
];

const IMAGE_RATIOS = [
  null,
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "9:16",
  "16:9",
  "21:9",
] as const;
const IMAGE_SIZES = [null, "1K", "2K", "4K"] as const;
const VIDEO_RATIOS = [null, "16:9", "9:16"] as const;
const VIDEO_DURATIONS = [null, 3, 4, 5, 6, 8, 10] as const;
const OUTPUT_COUNTS = [1, 2, 4, 8] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className='space-y-1.5'>
      <div className='text-[11px] font-semibold uppercase tracking-wide text-slate-400'>
        {title}
      </div>
      {children}
    </section>
  );
}

function ChoiceGrid<T extends string | number | null>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  return (
    <div className='flex flex-wrap gap-1'>
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={String(option ?? "auto")}
            type='button'
            onClick={() => onChange(option)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] transition-colors",
              active
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {label(option)}
          </button>
        );
      })}
    </div>
  );
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
  const xiaotModel = useAIChatStore((s) => s.xiaotModel);
  const setXiaotModel = useAIChatStore((s) => s.setXiaotModel);
  const preferredImage = useAIChatStore((s) => s.xiaotPreferredImage);
  const setPreferredImage = useAIChatStore((s) => s.setXiaotPreferredImage);
  const preferredVideo = useAIChatStore((s) => s.xiaotPreferredVideo);
  const setPreferredVideo = useAIChatStore((s) => s.setXiaotPreferredVideo);
  const aspectRatio = useAIChatStore((s) => s.aspectRatio);
  const setAspectRatio = useAIChatStore((s) => s.setAspectRatio);
  const imageSize = useAIChatStore((s) => s.imageSize);
  const setImageSize = useAIChatStore((s) => s.setImageSize);
  const videoAspectRatio = useAIChatStore((s) => s.videoAspectRatio);
  const setVideoAspectRatio = useAIChatStore((s) => s.setVideoAspectRatio);
  const videoDuration = useAIChatStore((s) => s.videoDurationSeconds);
  const setVideoDuration = useAIChatStore((s) => s.setVideoDurationSeconds);
  const outputCount = useAIChatStore((s) => s.autoModeMultiplier);
  const setOutputCount = useAIChatStore((s) => s.setAutoModeMultiplier);

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [assetName, setAssetName] = useState<string | undefined>();
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription(anchor?.description ?? "");
    setImageUrl(anchor?.imageUrl);
    setAssetName(anchor?.assetName);
    setLibraryOpen(false);
  }, [anchor, open]);

  const saveStyle = () => {
    if (description.trim() || imageUrl) {
      setAnchor({ imageUrl, assetName, description: description.trim() });
    } else {
      clearAnchor();
    }
  };

  const handleDone = () => {
    saveStyle();
    setOpen(false);
  };

  const handleSelectFromLibrary = (url: string, name?: string) => {
    setImageUrl(url);
    setAssetName(name);
    setAnchor({ imageUrl: url, assetName: name, description: description.trim() });
    setLibraryOpen(false);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            className={cn(
              "h-7 gap-1 rounded-full border px-2.5 text-xs transition-all",
              "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass",
              isBlackTheme
                ? "border-gray-600 text-gray-300 hover:bg-white/10"
                : "text-gray-700 hover:bg-gray-100"
            )}
            title={lt("小T统一设置", "XiaoT settings")}
          >
            <Settings2 className='h-3.5 w-3.5' />
            <span className='font-medium'>{lt("设置", "Settings")}</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align='start'
          side={dropdownSide}
          sideOffset={8}
          className='w-[380px] max-h-[72vh] overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur-md'
        >
          <div className='space-y-4 text-xs'>
            <Section title={lt("小T大脑", "XiaoT brain")}>
              <ChoiceGrid
                options={BRAIN_OPTIONS.map((option) => option.value)}
                value={xiaotModel}
                onChange={setXiaotModel}
                label={(value) =>
                  BRAIN_OPTIONS.find((option) => option.value === value)?.label || String(value)
                }
              />
            </Section>

            <Section title={lt("图片模型", "Image model")}>
              <ChoiceGrid
                options={XIAOT_PREFERRED_IMAGE_MODELS.map((option) => option.value)}
                value={preferredImage}
                onChange={setPreferredImage}
                label={(value) =>
                  XIAOT_PREFERRED_IMAGE_MODELS.find((option) => option.value === value)?.short ||
                  String(value)
                }
              />
            </Section>

            <Section title={lt("视频模型", "Video model")}>
              <ChoiceGrid
                options={XIAOT_PREFERRED_VIDEO_MODELS.map((option) => option.value)}
                value={preferredVideo}
                onChange={setPreferredVideo}
                label={(value) =>
                  XIAOT_PREFERRED_VIDEO_MODELS.find((option) => option.value === value)?.short ||
                  String(value)
                }
              />
            </Section>

            <div className='grid grid-cols-2 gap-3 border-t border-slate-100 pt-3'>
              <Section title={lt("图片比例", "Image ratio")}>
                <ChoiceGrid
                  options={IMAGE_RATIOS}
                  value={aspectRatio as (typeof IMAGE_RATIOS)[number]}
                  onChange={(value) => setAspectRatio(value)}
                  label={(value) => value || lt("自动", "Auto")}
                />
              </Section>
              <Section title={lt("图片尺寸", "Image size")}>
                <ChoiceGrid
                  options={IMAGE_SIZES}
                  value={imageSize as (typeof IMAGE_SIZES)[number]}
                  onChange={(value) => setImageSize(value)}
                  label={(value) => value || lt("自动", "Auto")}
                />
              </Section>
              <Section title={lt("视频比例", "Video ratio")}>
                <ChoiceGrid
                  options={VIDEO_RATIOS}
                  value={videoAspectRatio}
                  onChange={setVideoAspectRatio}
                  label={(value) => value || lt("自动", "Auto")}
                />
              </Section>
              <Section title={lt("视频时长", "Video duration")}>
                <ChoiceGrid
                  options={VIDEO_DURATIONS}
                  value={videoDuration}
                  onChange={setVideoDuration}
                  label={(value) => (value ? `${value}s` : lt("自动", "Auto"))}
                />
              </Section>
            </div>

            <Section title={lt("图片数量", "Image count")}>
              <ChoiceGrid
                options={OUTPUT_COUNTS}
                value={outputCount}
                onChange={setOutputCount}
                label={(value) => `${value}X`}
              />
            </Section>

            <Section title={lt("风格锚定", "Style anchor")}>
              {imageUrl ? (
                <div className='flex items-center gap-2 rounded-lg border border-slate-200 p-2'>
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
                    className='rounded p-1 text-slate-400 hover:bg-gray-100'
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
                  {lt("从资产库选择风格参考图", "Pick a style reference")}
                </button>
              )}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                placeholder={lt(
                  "如：赛博朋克霓虹夜景、品红青色高对比",
                  "e.g. cyberpunk neon night, magenta-cyan contrast"
                )}
                className='mt-2 w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400'
              />
            </Section>

            <div className='flex justify-end border-t border-slate-100 pt-2'>
              <button
                type='button'
                className='flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800'
                onClick={handleDone}
              >
                <Check className='h-3.5 w-3.5' />
                {lt("完成", "Done")}
              </button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

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
