/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js,jsx,ts,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
      },
      boxShadow: {
        'header': '0 2px 8px rgba(0, 0, 0, 0.08)',
        // Apple Liquid Glass 样式 - 移除白色高光版本
        'liquid-glass': '0 8px 32px rgba(0, 0, 0, 0.06)',
        'liquid-glass-lg': '0 16px 48px rgba(0, 0, 0, 0.08)',
      },
      backdropBlur: {
        'xs': '2px',
        'minimal': '8px',
        'light': '10px',
        'liquid': '20px',
        'xl': '32px',
      },
      backdropSaturate: {
        '110': '1.1',
        '125': '1.25',
        '150': '1.5',
        '180': '1.8',
      },
      backgroundColor: {
        // Apple Liquid Glass 背景色 - 降低透明度版本
        'liquid-glass': 'rgba(255, 255, 255, 0.08)',
        'liquid-glass-light': 'rgba(255, 255, 255, 0.06)',
        'liquid-glass-hover': 'rgba(255, 255, 255, 0.12)',
        'liquid-glass-active': 'rgba(255, 255, 255, 0.15)',
      },
      borderColor: {
        // Apple Liquid Glass 边框色 - 中性灰色版本
        'liquid-glass': 'rgba(0, 0, 0, 0.1)',
        'liquid-glass-light': 'rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
}

