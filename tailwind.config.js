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
      }
    },
  },
  plugins: [],
}

