/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
    "./electron/**/*.{html,ts}"
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary)',
        'primary-light': 'var(--primary-light)',
        secondary: 'var(--secondary)',
        bg: 'var(--bg)',
        card: 'var(--card)',
        text: 'var(--text)',
        'text-light': 'var(--text-light)',
        border: 'var(--border)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        tajawal: ['Tajawal', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
