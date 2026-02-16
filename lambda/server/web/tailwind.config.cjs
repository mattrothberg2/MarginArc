/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#e6eaf0',
          100: '#c2cbdb',
          200: '#9aabc4',
          300: '#728aad',
          400: '#54729d',
          500: '#365a8c',
          600: '#2f5282',
          700: '#264875',
          800: '#1d3e68',
          900: '#0a1a2f',
          950: '#060f1a',
        },
        teal: {
          50: '#e0f7f8',
          100: '#b3ecee',
          200: '#80e0e3',
          300: '#4dd3d8',
          400: '#26c9cf',
          500: '#02b1b5',
          600: '#00a3a7',
          700: '#009196',
          800: '#008086',
          900: '#006166',
          950: '#003f42',
        },
        sf: {
          blue: '#00A1E0',
          dark: '#032D60',
          light: '#E8F4FD',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
