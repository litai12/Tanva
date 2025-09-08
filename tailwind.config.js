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
        // Apple Liquid Glass 样式 - 清洁简化版本
        'liquid-glass': '0 8px 32px rgba(0, 0, 0, 0.04), 0 0 0 0.5px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
        'liquid-glass-lg': '0 16px 48px rgba(0, 0, 0, 0.06), 0 0 0 0.5px rgba(255, 255, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
      },
      backdropBlur: {
        'xs': '2px',
        'liquid': '12px',
      },
      backdropSaturate: {
        '150': '1.5',
      },
      backgroundColor: {
        // Apple Liquid Glass 背景色 - 清洁简化版本
        'liquid-glass': 'rgba(255, 255, 255, 0.15)',
        'liquid-glass-light': 'rgba(255, 255, 255, 0.1)',
        'liquid-glass-hover': 'rgba(255, 255, 255, 0.25)',
        'liquid-glass-active': 'rgba(255, 255, 255, 0.3)',
      },
      borderColor: {
        // Apple Liquid Glass 边框色 - 清洁简化版本
        'liquid-glass': 'rgba(255, 255, 255, 0.2)',
        'liquid-glass-light': 'rgba(255, 255, 255, 0.15)',
      }
    },
  },
  plugins: [],
}

