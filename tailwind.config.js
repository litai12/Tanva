/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js,jsx,ts,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      boxShadow: {
        'header': '0 2px 8px rgba(0, 0, 0, 0.08)',
        // Apple Liquid Glass 样式 - 白光内阴影版本
        'liquid-glass': '0 8px 32px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
        'liquid-glass-lg': '0 16px 48px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
      },
      backdropBlur: {
        'xs': '2px',
        'minimal': '4px',
        'light': '6px',
        'liquid': '12px',
        'xl': '24px',
      },
      backdropSaturate: {
        '150': '1.5',
        '180': '1.8',
      },
      backgroundColor: {
        // Apple Liquid Glass 背景色 - 极致透明版本
        'liquid-glass': 'rgba(255, 255, 255, 0.03)',
        'liquid-glass-light': 'rgba(255, 255, 255, 0.02)',
        'liquid-glass-hover': 'rgba(255, 255, 255, 0.06)',
        'liquid-glass-active': 'rgba(255, 255, 255, 0.08)',
      },
      borderColor: {
        // Apple Liquid Glass 边框色 - 简化版本
        'liquid-glass': 'rgba(255, 255, 255, 0.2)',
        'liquid-glass-light': 'rgba(255, 255, 255, 0.15)',
      }
    },
  },
  plugins: [],
}

