import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline';
}

const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', ...props }) => {
  const baseClasses = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors";
  
  const variantClasses = {
    default: "bg-gray-900 text-white",
    secondary: "bg-gray-200 text-gray-900", 
    outline: "border border-gray-300 text-gray-700 bg-white"
  };

  return (
    <div
      className={cn(
        baseClasses,
        variantClasses[variant], 
        className
      )}
      {...props}
    />
  );
};

export { Badge }; 