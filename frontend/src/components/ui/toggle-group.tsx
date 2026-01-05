import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { cn } from "@/lib/utils"

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(
      "inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-1",
      className
    )}
    {...props}
  />
))
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & {
    size?: "sm" | "md"
  }
>(({ className, size = "md", ...props }, ref) => {
  const sizeClasses = {
    sm: "text-xs px-3 py-1",
    md: "text-sm px-4 py-1.5"
  }

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "font-medium transition-all rounded-md",
        "text-slate-500 dark:text-slate-400",
        "hover:text-slate-700 dark:hover:text-slate-200",
        "data-[state=on]:bg-slate-900 dark:data-[state=on]:bg-slate-100 data-[state=on]:text-white dark:data-[state=on]:text-slate-900 data-[state=on]:shadow-sm",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 dark:focus-visible:ring-slate-300 focus-visible:ring-offset-1",
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
})
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }

