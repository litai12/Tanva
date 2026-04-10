import React from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
              ? "tanva-agent-toolbar-btn h-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 px-2 text-[10px] font-medium inline-flex items-center gap-1.5"
              : "w-full inline-flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-900 shadow-sm transition-colors hover:border-slate-300",
            className
          )}
        >
          <span className={cn("truncate", variant === "compact" ? "max-w-[56px]" : "flex-1")}>
            {currentOption?.label || value}
          </span>
          <ChevronDown className={cn("shrink-0", variant === "compact" ? "h-3.5 w-3.5" : "h-4 w-4 text-slate-500")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side='bottom'
        sideOffset={8}
        className={cn(
          "min-w-[160px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md",
          contentClassName
        )}
      >
        {menuLabel ? (
          <div className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400'>
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
                "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                isActive ? "bg-gray-100 text-gray-800" : "text-slate-600"
              )}
            >
              <div className='flex-1 space-y-0.5'>
                <div className='font-medium leading-none'>{option.label}</div>
                {option.description ? (
                  <div className='text-[11px] leading-snug text-slate-400'>{option.description}</div>
                ) : null}
              </div>
              {isActive ? <Check className='h-3.5 w-3.5 text-slate-700' /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
