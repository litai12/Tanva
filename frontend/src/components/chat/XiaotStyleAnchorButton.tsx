// 小T「风格锚定」按钮 + 轻量弹层：风格参考图（资产库）+ 风格描述 + 摄像机预设。
// 自持状态直接读写 aiChatStore（xiaotStyleAnchor，会话级不 persist）。
// 资产选择复用 materialLibraryApi（kind:"style" 服务端过滤；个人/团队按 teamStore 判定），
// getAssetImageUrl 取原始 URL 存入 store（不 proxify），预览交给 SmartImage 内部 proxify。
import React, { useEffect, useState } from "react";
import { Palette, Check, X, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import SmartImage from "@/components/ui/SmartImage";
import {
  listMaterialAssets,
  listTeamMaterialAssets,
  getAssetImageUrl,
  type MaterialAssetDto,
} from "@/services/materialLibraryApi";
import { useTeamStore } from "@/stores/teamStore";
import { useAIChatStore } from "@/stores/aiChatStore";

interface Props {
  isBlackTheme: boolean;
  disabled?: boolean;
  dropdownSide?: "top" | "bottom" | "left" | "right";
  lt: (zh: string, en: string) => string;
}

const SHOT_SIZES = ["特写", "近景", "中景", "全景", "远景", "航拍"];
const MOVEMENTS = ["固定", "推", "拉", "摇", "移", "环绕", "跟随"];

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
  const [shotSize, setShotSize] = useState("");
  const [movement, setMovement] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [assetName, setAssetName] = useState<string | undefined>(undefined);

  // 资产选择子面板
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<MaterialAssetDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 资产库来源：个人 / 团队 —— 显式选择，不再隐式跟随当前激活团队
  const [assetScope, setAssetScope] = useState<"personal" | "team">("personal");

  const activeTeam = useTeamStore((s) => s.getActiveTeam());
  const teamId =
    activeTeam && !activeTeam.isPersonal ? activeTeam.id : null;

  const isActive = Boolean(
    anchor &&
      (anchor.description.trim() ||
        anchor.camera.shotSize ||
        anchor.camera.movement ||
        anchor.imageUrl)
  );

  // 打开弹层时以当前 store 值填充草稿
  useEffect(() => {
    if (open) {
      setDescription(anchor?.description ?? "");
      setShotSize(anchor?.camera.shotSize ?? "");
      setMovement(anchor?.camera.movement ?? "");
      setImageUrl(anchor?.imageUrl);
      setAssetName(anchor?.assetName);
      setPickerOpen(false);
      // 默认落在当前上下文（在团队里默认团队库，否则个人库），仍可在 picker 里切换
      setAssetScope(teamId ? "team" : "personal");
      setAssets([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAssets = async (scope: "personal" | "team") => {
    setLoading(true);
    setLoadError(null);
    try {
      const list =
        scope === "team" && teamId
          ? await listTeamMaterialAssets({ teamId, kind: "style" })
          : await listMaterialAssets({ kind: "style" });
      setAssets(list);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : lt("加载失败", "Load failed")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePicker = () => {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next && assets.length === 0 && !loading) {
      void loadAssets(assetScope);
    }
  };

  // 切换个人/团队来源：清空并按新来源重载（团队来源需有激活团队）
  const handleScopeChange = (scope: "personal" | "team") => {
    if (scope === assetScope) return;
    if (scope === "team" && !teamId) return;
    setAssetScope(scope);
    setAssets([]);
    void loadAssets(scope);
  };

  const handlePickAsset = (asset: MaterialAssetDto) => {
    const url = getAssetImageUrl(asset);
    if (!url) return;
    setImageUrl(url);
    setAssetName(asset.name);
    setPickerOpen(false);
  };

  const handleDone = () => {
    const hasContent =
      description.trim() || shotSize || movement || imageUrl;
    if (hasContent) {
      setAnchor({
        imageUrl,
        assetName,
        description: description.trim(),
        camera: {
          shotSize: shotSize || undefined,
          movement: movement || undefined,
        },
      });
    } else {
      clearAnchor();
    }
    setOpen(false);
  };

  const handleClear = () => {
    clearAnchor();
    setDescription("");
    setShotSize("");
    setMovement("");
    setImageUrl(undefined);
    setAssetName(undefined);
    setOpen(false);
  };

  const chipClass = (selected: boolean) =>
    cn(
      "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
      selected
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 text-slate-600 hover:bg-gray-100"
    );

  return (
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
          title={lt("风格锚定（参考图/描述/运镜）", "Style anchor (reference / description / camera)")}
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
                onClick={handleTogglePicker}
              >
                <ImageIcon className='h-3.5 w-3.5' />
                {lt("从资产库选择", "Pick from library")}
              </button>
            )}
            {pickerOpen && (
              <div className='mt-2 space-y-1.5'>
                {/* 个人 / 团队 来源切换 */}
                <div className='flex gap-1'>
                  <button
                    type='button'
                    className={chipClass(assetScope === "personal")}
                    onClick={() => handleScopeChange("personal")}
                  >
                    {lt("个人", "Personal")}
                  </button>
                  <button
                    type='button'
                    disabled={!teamId}
                    title={
                      !teamId
                        ? lt("切换到团队后可选", "Switch to a team first")
                        : undefined
                    }
                    className={cn(
                      chipClass(assetScope === "team"),
                      !teamId && "cursor-not-allowed opacity-40"
                    )}
                    onClick={() => handleScopeChange("team")}
                  >
                    {lt("团队", "Team")}
                  </button>
                </div>
                <div className='max-h-40 overflow-y-auto rounded-md border border-slate-200 p-1.5'>
                  {loading ? (
                    <div className='flex items-center justify-center gap-1.5 py-3 text-slate-400'>
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      {lt("加载中…", "Loading…")}
                    </div>
                  ) : loadError ? (
                    <div className='py-3 text-center text-red-500'>
                      {loadError}
                    </div>
                  ) : assets.length === 0 ? (
                    <div className='py-3 text-center text-slate-400'>
                      {lt("暂无风格资产", "No style assets")}
                    </div>
                  ) : (
                    <div className='grid grid-cols-4 gap-1.5'>
                      {assets.map((asset) => {
                        const url = getAssetImageUrl(asset);
                        return (
                          <button
                            key={asset.id}
                            type='button'
                            className='group relative aspect-square overflow-hidden rounded border border-slate-200 hover:border-slate-900'
                            title={asset.name}
                            onClick={() => handlePickAsset(asset)}
                          >
                            <SmartImage
                              src={url}
                              alt={asset.name}
                              className='h-full w-full object-cover'
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
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

          {/* 景别 */}
          <div>
            <div className='mb-1 font-medium text-slate-700'>
              {lt("景别", "Shot size")}
            </div>
            <div className='flex flex-wrap gap-1'>
              <button
                type='button'
                className={chipClass(!shotSize)}
                onClick={() => setShotSize("")}
              >
                {lt("不限", "Any")}
              </button>
              {SHOT_SIZES.map((opt) => (
                <button
                  key={opt}
                  type='button'
                  className={chipClass(shotSize === opt)}
                  onClick={() => setShotSize(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* 运镜 */}
          <div>
            <div className='mb-1 font-medium text-slate-700'>
              {lt("运镜", "Movement")}
            </div>
            <div className='flex flex-wrap gap-1'>
              <button
                type='button'
                className={chipClass(!movement)}
                onClick={() => setMovement("")}
              >
                {lt("不限", "Any")}
              </button>
              {MOVEMENTS.map((opt) => (
                <button
                  key={opt}
                  type='button'
                  className={chipClass(movement === opt)}
                  onClick={() => setMovement(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
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
  );
}
