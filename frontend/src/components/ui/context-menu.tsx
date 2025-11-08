/**
 * 简单的上下文菜单组件
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}

interface ContextMenuProps {
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-glass-light backdrop-blur-md rounded-lg shadow-glass border border-glass py-1 min-w-[120px]"
            style={{
                left: x,
                top: y,
            }}
        >
            {items.map((item, index) => (
                <button
                    key={index}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2 transition-colors ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        }`}
                    onClick={() => {
                        if (!item.disabled) {
                            item.onClick();
                            onClose();
                        }
                    }}
                    disabled={item.disabled}
                >
                    {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
                    <span>{item.label}</span>
                </button>
            ))}
        </div>,
        document.body
    );
};

export default ContextMenu;
