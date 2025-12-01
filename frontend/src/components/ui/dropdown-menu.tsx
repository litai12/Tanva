// @ts-nocheck
import * as React from "react"
import { cn } from "@/lib/utils"

// 简化版本的DropdownMenu组件
export interface DropdownMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, open: controlledOpen, onOpenChange, ...props }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  
  // 支持受控和非受控模式
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = React.useCallback((value: boolean) => {
    if (controlledOpen !== undefined) {
      // 受控模式：调用外部回调
      onOpenChange?.(value);
    } else {
      // 非受控模式：使用内部状态
      setInternalOpen(value);
    }
  }, [controlledOpen, onOpenChange]);
  
  const handleToggle = () => setIsOpen(!isOpen);
  const handleClose = () => setIsOpen(false);
  
  return (
    <div className="relative dropdown-menu-root" {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          // 使用组件类型而非 role 属性来识别组件
          if (child.type === DropdownMenuTrigger) {
            const originalOnClick = child.props?.onClick;
            const composedOnClick = (event: React.MouseEvent<HTMLButtonElement>) => {
              if (typeof originalOnClick === 'function') {
                originalOnClick(event);
              }
              if (!event.defaultPrevented) {
                handleToggle();
              }
            };
            return React.cloneElement(child as React.ReactElement, {
              onClick: composedOnClick
            });
          }
          if (child.type === DropdownMenuContent) {
            return React.cloneElement(child as React.ReactElement, {
              isOpen,
              onClose: handleClose
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
  sideOffset = 8,
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

  // 位置类：支持 top/right/bottom/left 四个方向，默认 bottom（下方）
  const sideClass = (() => {
    switch (side) {
      case 'top':
        return 'bottom-full';
      case 'right':
        return 'left-full top-0';
      case 'left':
        return 'right-full top-1/2 -translate-y-1/2';
      case 'bottom':
      default:
        return 'top-full';
    }
  })();

  // 动态偏移样式
  const offsetStyle = (() => {
    switch (side) {
      case 'top':
        return { marginBottom: `${sideOffset}px` };
      case 'right':
        return { marginLeft: `${sideOffset}px` };
      case 'left':
        return { marginRight: `${sideOffset}px` };
      case 'bottom':
      default:
        return { marginTop: `${sideOffset}px` };
    }
  })();

  // 水平/垂直对齐类
  const alignClass = (() => {
    // 垂直方向(top/bottom)：控制左右对齐
    if (!side || side === 'bottom' || side === 'top') {
      return align === 'start'
        ? 'left-0 right-auto'
        : align === 'center'
        ? 'left-1/2 -translate-x-1/2'
        : 'right-0';
    }
    // 水平方向(left/right)：控制上下对齐
    return align === 'start'
      ? 'top-0'
      : align === 'center'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-0';
  })();

  return (
    <DropdownMenuContext.Provider value={{ onClose }}>
      <div 
        className={cn(
          'absolute z-[1100] w-48 bg-glass-light backdrop-blur-md rounded-md shadow-glass border border-glass',
          sideClass,
          alignClass,
          className
        )} 
        style={offsetStyle}
        {...props}
      >
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
};

// Context 用于传递 onClose 函数
const DropdownMenuContext = React.createContext<{ onClose?: () => void }>({});

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({ children, className, onClick, ...props }) => {
  const { onClose } = React.useContext(DropdownMenuContext);
  
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) {
      onClick(e);
    }
    // 点击后关闭菜单
    if (onClose && !e.defaultPrevented) {
      onClose();
    }
  };

  return (
    <button
      className={cn(
        "w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center first:rounded-t-md last:rounded-b-md",
        className
      )}
      onClick={handleClick}
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
