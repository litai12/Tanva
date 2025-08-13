import * as React from "react"
import { cn } from "@/lib/utils"

// 简化版本的DropdownMenu组件
export interface DropdownMenuProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DropdownMenu({ children, ...props }: DropdownMenuProps) {
  return <div className="relative" {...props}>{children}</div>
}

export interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <button 
        ref={ref}
        className={cn("inline-flex items-center", className)} 
        {...props}
      >
        {children}
      </button>
    )
  }
)
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end'
  forceMount?: boolean
}

export function DropdownMenuContent({ 
  children, 
  className, 
  align = 'end',
  forceMount,
  ...props 
}: DropdownMenuContentProps) {
  return (
    <div 
      className={cn(
        "hidden absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50",
        align === 'start' && 'left-0 right-auto',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        className
      )} 
      {...props}
    >
      {children}
    </div>
  )
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function DropdownMenuItem({ children, className, ...props }: DropdownMenuItemProps) {
  return (
    <button
      className={cn(
        "w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center first:rounded-t-md last:rounded-b-md",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export interface DropdownMenuLabelProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DropdownMenuLabel({ children, className, ...props }: DropdownMenuLabelProps) {
  return (
    <div
      className={cn("px-4 py-2 text-xs font-medium text-gray-500", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("h-px bg-gray-200 my-1", className)}
      {...props}
    />
  )
}