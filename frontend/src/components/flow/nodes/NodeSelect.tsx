import React from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFlowNodeDarkTheme } from "./flowNodeDarkTheme";

export type NodeSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type NodeSelectProps = {
  value: string;
  options: NodeSelectOption[];
  onChange: (value: string) => void;
  title?: string;
  menuLabel?: string;
  variant?: "field" | "compact";
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
};

export default function NodeSelect({
  value,
  options,
  onChange,
  title,
  menuLabel,
  variant = "field",
  className,
  contentClassName,
  align = "start",
}: NodeSelectProps) {
  const isFlowDark = useFlowNodeDarkTheme();
  const currentOption =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
          }}
          title={title}
          className={cn(
            "nodrag nopan",
            variant === "compact"
              ? isFlowDark
                ? "tanva-agent-toolbar-btn h-8 rounded-full bg-[#252525]/95 border border-[#404040] text-[#e5e7eb] transition-all duration-200 hover:bg-[#2d2d2d] hover:border-[#4b5563] px-2 text-[10px] font-medium inline-flex items-center gap-1.5"
                : "tanva-agent-toolbar-btn h-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 px-2 text-[10px] font-medium inline-flex items-center gap-1.5"
              : isFlowDark
              ? "w-full inline-flex items-center justify-between rounded-lg border border-[#404040] bg-[#252525] px-3 py-1.5 text-left text-xs text-[#e5e7eb] shadow-sm transition-colors hover:border-[#4b5563]"
              : "w-full inline-flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-900 shadow-sm transition-colors hover:border-slate-300",
            className
          )}
        >
          <span className={cn("truncate", variant === "compact" ? "max-w-[56px]" : "flex-1")}>
            {currentOption?.label || value}
          </span>
          <ChevronDown
            className={cn(
              "shrink-0",
              variant === "compact"
                ? "h-3.5 w-3.5"
                : isFlowDark
                ? "h-4 w-4 text-[#9ca3af]"
                : "h-4 w-4 text-slate-500"
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side='bottom'
        sideOffset={8}
        className={cn(
          isFlowDark
            ? "min-w-[160px] rounded-xl border border-[#404040] bg-[#1e1e1e]/95 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.45)] backdrop-blur-md"
            : "min-w-[160px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md",
          contentClassName
        )}
      >
        {menuLabel ? (
          <div
            className={cn(
              "px-3 py-2 text-[11px] uppercase tracking-wide",
              isFlowDark ? "text-[#9ca3af]" : "text-slate-400"
            )}
          >
            {menuLabel}
          </div>
        ) : null}
        {options.map((option) => {
          const isActive = option.value === currentOption?.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={(event) => {
                event.stopPropagation();
                onChange(option.value);
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-xs transition-colors",
                isFlowDark
                  ? isActive
                    ? "bg-blue-500/20 text-blue-100 hover:bg-blue-500/25"
                    : "text-[#e5e7eb] hover:bg-[#2a2a2a]"
                  : isActive
                  ? "bg-gray-100 text-gray-800"
                  : "text-slate-600"
              )}
            >
              <div className='flex-1 space-y-0.5'>
                <div className='font-medium leading-none'>{option.label}</div>
                {option.description ? (
                  <div
                    className={cn(
                      "text-[11px] leading-snug",
                      isFlowDark ? "text-[#9ca3af]" : "text-slate-400"
                    )}
                  >
                    {option.description}
                  </div>
                ) : null}
              </div>
              {isActive ? (
                <Check
                  className={cn(
                    "h-3.5 w-3.5",
                    isFlowDark ? "text-blue-200" : "text-slate-700"
                  )}
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
