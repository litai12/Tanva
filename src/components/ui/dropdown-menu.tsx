import * as React from "react"
import { cn } from "@/lib/utils"

// 简化版本的DropdownMenu组件
export interface DropdownMenuProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, ...props }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const handleToggle = () => setIsOpen(!isOpen);
  const handleClose = () => setIsOpen(false);
  
  return (
    <div className="relative dropdown-menu-root" {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          // 使用组件类型而非 role 属性来识别组件
          if (child.type === DropdownMenuTrigger) {
            return React.cloneElement(child as React.ReactElement, {
              onClick: handleToggle,
              ...child.props
            });
          }
          if (child.type === DropdownMenuContent) {
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
  ({ children, className, asChild = false, ...props }, ref) => {
    // 如果使用 asChild，则将 props 传递给第一个子元素
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement, {
        ...props,
        className: cn(children.props.className, className),
        ref
      });
    }
    
    // 否则渲染标准的 button 元素
    return (
      <button 
        ref={ref}
        className={cn("inline-flex items-center", className)} 
        {...props}
      >
        {children}
      </button>
    );
  }
)
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end'
  // 兼容 shadcn/radix API（避免将未知属性传给 DOM）
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  forceMount?: boolean
  isOpen?: boolean
  onClose?: () => void
}

export const DropdownMenuContent: React.FC<DropdownMenuContentProps> = ({ 
  children, 
  className, 
  align = 'end',
  side,
  sideOffset,
  forceMount,
  isOpen = false,
  onClose,
  ...props 
}) => {
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && onClose) {
        const target = event.target as Element;
        // 检查点击是否在下拉菜单内容或触发器上
        const dropdown = (event.target as Element).closest('.dropdown-menu-root');
        if (!dropdown) {
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

  // 处理方位与偏移，仅用于样式，不透传到 DOM
  const offsetStyle: React.CSSProperties | undefined = sideOffset ? { marginTop: side === 'top' ? undefined : side === 'bottom' || !side ? sideOffset : undefined, marginLeft: side === 'right' ? sideOffset : side === 'left' ? undefined : undefined } : undefined;

  return (
    <div 
      className={cn(
        "absolute right-0 mt-2 w-48 bg-glass-light backdrop-blur-md rounded-md shadow-glass border border-glass z-50",
        align === 'start' && 'left-0 right-auto',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        className
      )}
      style={offsetStyle}
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
