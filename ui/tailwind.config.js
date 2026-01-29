/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        emerald: {
          DEFAULT: '#10b981',
          glow: 'rgba(16, 185, 129, 0.15)',
        },
        brand: {
          dark: '#0a0e14',
          darker: '#060a0f',
        }
      },
    },
  },
  plugins: [],
}
