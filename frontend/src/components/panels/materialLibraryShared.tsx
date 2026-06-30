import React from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MaterialKindDto } from "@/services/materialLibraryApi";

export const FOLDER_DEFS: { kind: MaterialKindDto; label: string }[] = [
  { kind: "character", label: "角色" },
  { kind: "scene", label: "场景" },
  { kind: "prop", label: "道具" },
  { kind: "style", label: "风格" },
  { kind: "text", label: "Others" },
];

export const toast = (
  message: string,
  type: "success" | "error" | "warning" | "info" = "info"
) => {
  try {
    window.dispatchEvent(new CustomEvent("toast", { detail: { message, type } }));
  } catch {
    /* ignore */
  }
};

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Generic centered modal (portal) ───────────────────────────────────────────

export function CenteredModal({
  open,
  title,
  icon,
  onClose,
  children,
  width = 380,
}: {
  open: boolean;
  title: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-xl border border-gray-200 bg-white shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          {icon}
          <div className="flex-1 text-sm font-semibold text-gray-900">{title}</div>
          <button
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Folder select modal (upload target & move target) ──────────────────────────

export function FolderSelectModal({
  open,
  title = "选择文件夹",
  excludeKind,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  excludeKind?: MaterialKindDto;
  onClose: () => void;
  onConfirm: (kind: MaterialKindDto) => void;
}) {
  const [selected, setSelected] = React.useState<MaterialKindDto | null>(null);
  const folders = FOLDER_DEFS.filter((f) => f.kind !== excludeKind);

  React.useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      icon={<FolderIcon className="h-4 w-4 text-gray-500" />}
      title={title}
    >
      <div className="space-y-1">
        {folders.map((f) => (
          <button
            key={f.kind}
            onClick={() => setSelected(f.kind)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
              selected === f.kind
                ? "bg-gray-900/5 ring-1 ring-gray-900/20"
                : "hover:bg-gray-100"
            )}
          >
            <FolderIcon className="h-4 w-4 shrink-0 text-gray-500" />
            <span className="flex-1 text-sm text-gray-800">{f.label}</span>
            <ChevronRight className="h-3 w-3 text-gray-300" />
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
        >
          确认
        </button>
      </div>
    </CenteredModal>
  );
}

// ── New folder modal ───────────────────────────────────────────────────────────

export function NewFolderModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  };

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      icon={<FolderPlus className="h-4 w-4 text-gray-500" />}
      title="新建文件夹"
    >
      <input
        ref={inputRef}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        placeholder="文件夹名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={!name.trim()}
          onClick={handleConfirm}
        >
          创建
        </button>
      </div>
    </CenteredModal>
  );
}

// ── Rename modal ───────────────────────────────────────────────────────────────

export function RenameModal({
  open,
  initialName,
  onClose,
  onConfirm,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = React.useState(initialName);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 60);
    }
  }, [open, initialName]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== initialName) onConfirm(trimmed);
    onClose();
  };

  return (
    <CenteredModal open={open} onClose={onClose} title="重命名素材">
      <input
        ref={inputRef}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        placeholder="素材名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={!name.trim()}
          onClick={handleConfirm}
        >
          确认
        </button>
      </div>
    </CenteredModal>
  );
}

// ── Lightweight click-outside action menu ──────────────────────────────────────

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active: boolean
) {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [active, onOutside]);
  return ref;
}
