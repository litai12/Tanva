import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "settings"
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "default", ...props }, ref) => {
    const variantClasses = {
      default: "border-input focus-visible:ring-1 focus-visible:ring-ring",
      settings: "border-slate-200 focus:border-slate-400 focus:ring-0"
    }
    
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border bg-white px-3 py-2 text-sm transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "placeholder:text-slate-400",
          "focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[variant],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }