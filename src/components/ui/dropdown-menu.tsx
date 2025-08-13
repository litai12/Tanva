import * as React from "react"
import { cn } from "@/lib/utils"

// 简化版本的DropdownMenu组件
export interface DropdownMenuProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, ...props }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const handleToggle = () => setIsOpen(!isOpen);
  const handleClose = () => setIsOpen(false);
  
  return (
    <div className="relative" {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          if (child.props.role === 'trigger') {
            return React.cloneElement(child as React.ReactElement, {
              onClick: handleToggle,
              ...child.props
            });
          }
          if (child.props.role === 'content') {
            return React.cloneElement(child as React.ReactElement, {
              isOpen,
              onClose: handleClose,
              ...child.props
            });
          }
        }
        return child;
      })}
    </div>
  );
};

export interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <button 
        ref={ref}
        role="trigger"
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
  isOpen?: boolean
  onClose?: () => void
}

export const DropdownMenuContent: React.FC<DropdownMenuContentProps> = ({ 
  children, 
  className, 
  align = 'end',
  forceMount,
  isOpen = false,
  onClose,
  ...props 
}) => {
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && onClose) {
        const target = event.target as Element;
        if (!target.closest('[role="content"]') && !target.closest('[role="trigger"]')) {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      role="content"
      className={cn(
        "absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50",
        align === 'start' && 'left-0 right-auto',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
};

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({ children, className, ...props }) => {
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
  );
};

export interface DropdownMenuLabelProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DropdownMenuLabel: React.FC<DropdownMenuLabelProps> = ({ children, className, ...props }) => {
  return (
    <div
      className={cn("px-4 py-2 text-xs font-medium text-gray-500", className)}
      {...props}
    >
      {children}
    </div>
  );
};

export const DropdownMenuSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => {
  return (
    <div
      className={cn("h-px bg-gray-200 my-1", className)}
      {...props}
    />
  );
};