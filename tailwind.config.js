/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
    "./electron/**/*.{html,ts}"
  ],
  theme: {
    extend: {
      colors: {
        // CSS relative-color syntax keeps the palette driven by the :root vars in
        // styles.scss while making Tailwind opacity modifiers (e.g. bg-primary/5,
        // border-primary/40) work. Plain `var(--x)` colors silently drop `/alpha`
        // modifiers, which caused selected-state tints, badges and hovers to
        // render with no background across the app.
        // Requires Chromium 119+ (Electron 30 ships Chromium 124).
        primary: 'rgb(from var(--primary) r g b / <alpha-value>)',
        'primary-light': 'rgb(from var(--primary-light) r g b / <alpha-value>)',
        secondary: 'rgb(from var(--secondary) r g b / <alpha-value>)',
        bg: 'rgb(from var(--bg) r g b / <alpha-value>)',
        card: 'rgb(from var(--card) r g b / <alpha-value>)',
        text: 'rgb(from var(--text) r g b / <alpha-value>)',
        'text-light': 'rgb(from var(--text-light) r g b / <alpha-value>)',
        border: 'rgb(from var(--border) r g b / <alpha-value>)',
        success: 'rgb(from var(--success) r g b / <alpha-value>)',
        warning: 'rgb(from var(--warning) r g b / <alpha-value>)',
        danger: 'rgb(from var(--danger) r g b / <alpha-value>)',
        info: 'rgb(from var(--info) r g b / <alpha-value>)',
      },
      fontFamily: {
        tajawal: ['Tajawal', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
