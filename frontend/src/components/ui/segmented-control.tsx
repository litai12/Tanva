import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { cn } from "@/lib/utils"

interface SegmentedControlOption {
  value: string
  label: string
}

interface SegmentedControlProps {
  options: SegmentedControlOption[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  size?: "sm" | "md"
  variant?: "pill" | "rounded"
}

const SegmentedControl = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  SegmentedControlProps
>(({ options, value, onValueChange, className, size = "md", variant = "pill" }, ref) => {
  const sizeClasses = {
    sm: "text-xs px-3 py-1.5",
    md: "text-sm px-4 py-2"
  }
  
  const variantClasses = {
    pill: "rounded-full",
    rounded: "rounded-lg"
  }

  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      value={value}
      onValueChange={onValueChange}
      className={cn("flex items-center gap-1", className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            "font-medium transition-all cursor-pointer",
            "border border-slate-200 bg-white text-slate-600",
            "hover:border-slate-300 hover:text-slate-900",
            "data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white data-[state=checked]:shadow-sm",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-1",
            sizeClasses[size],
            variantClasses[variant]
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
})
SegmentedControl.displayName = "SegmentedControl"

// 简单的按钮组选择器（不使用 RadioGroup，用于更简单的场景）
interface ToggleButtonGroupProps {
  options: SegmentedControlOption[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  size?: "sm" | "md"
  variant?: "pill" | "rounded"
}

const ToggleButtonGroup: React.FC<ToggleButtonGroupProps> = ({
  options,
  value,
  onValueChange,
  className,
  size = "md",
  variant = "pill"
}) => {
  const sizeClasses = {
    sm: "text-xs px-3 py-1.5",
    md: "text-sm px-4 py-2"
  }
  
  const variantClasses = {
    pill: "rounded-full",
    rounded: "rounded-lg"
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              "font-medium transition-all",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-1",
              sizeClasses[size],
              variantClasses[variant],
              isActive
                ? "border border-slate-900 bg-slate-900 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl, ToggleButtonGroup }
export type { SegmentedControlOption, SegmentedControlProps, ToggleButtonGroupProps }

