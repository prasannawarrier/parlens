/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#005A8C',
          dark: '#0070f3',
        },
        secondary: {
          DEFAULT: '#FFA500',
          dark: '#CC8400',
        },
        accent: '#00E5FF',
      },
      fontFamily: {
        serif: ['Crimson Pro', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'sign': '12px',
      },
      borderWidth: {
        'sign': '4px',
      },
      boxShadow: {
        'premium': '0 0 50px rgba(0,0,0,0.5)',
        'glow-primary': '0 0 30px rgba(0,112,243,0.4)',
        'glow-secondary': '0 0 30px rgba(255,165,0,0.4)',
      }
    },
  },
  plugins: [],
}
