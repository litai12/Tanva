import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-slate-300 text-slate-900 shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <div className="h-2 w-2 rounded-full bg-white" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

// 卡片式选项组件
interface RadioCardProps {
  value: string
  title: string
  description?: string
  icon?: React.ReactNode
  checked?: boolean
  accentColor?: string
}

const RadioCard = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & RadioCardProps
>(({ className, value, title, description, icon, accentColor = "slate", ...props }, ref) => {
  const colorStyles: Record<string, { border: string; bg: string; iconText: string; checkText: string }> = {
    slate: {
      border: "data-[state=checked]:border-slate-900",
      bg: "data-[state=checked]:bg-slate-50",
      iconText: "text-slate-600",
      checkText: "text-slate-900"
    },
    blue: {
      border: "data-[state=checked]:border-blue-500",
      bg: "data-[state=checked]:bg-blue-50",
      iconText: "text-blue-600",
      checkText: "text-blue-600"
    },
    green: {
      border: "data-[state=checked]:border-green-500",
      bg: "data-[state=checked]:bg-green-50",
      iconText: "text-green-600",
      checkText: "text-green-600"
    },
    amber: {
      border: "data-[state=checked]:border-amber-500",
      bg: "data-[state=checked]:bg-amber-50",
      iconText: "text-amber-600",
      checkText: "text-amber-600"
    },
    orange: {
      border: "data-[state=checked]:border-orange-500",
      bg: "data-[state=checked]:bg-orange-50",
      iconText: "text-orange-600",
      checkText: "text-orange-600"
    }
  }
  
  const colors = colorStyles[accentColor] || colorStyles.slate

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      value={value}
      className={cn(
        "relative rounded-xl border-2 p-4 text-left transition-all cursor-pointer",
        "border-slate-200 bg-white hover:border-slate-300",
        colors.border,
        colors.bg,
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {icon && <span className={colors.iconText}>{icon}</span>}
            <span className="text-sm font-medium text-slate-700">{title}</span>
          </div>
          {description && (
            <div className="text-xs text-slate-500">{description}</div>
          )}
        </div>
        <RadioGroupPrimitive.Indicator className="flex-shrink-0">
          <svg className={cn("w-5 h-5", colors.checkText)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </RadioGroupPrimitive.Indicator>
      </div>
    </RadioGroupPrimitive.Item>
  )
})
RadioCard.displayName = "RadioCard"

export { RadioGroup, RadioGroupItem, RadioCard }

