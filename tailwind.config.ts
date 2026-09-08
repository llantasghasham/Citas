import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Font stacks are declared in globals.css via @font-face on local files.
        arabic: ['Amiri', 'serif'],
        display: ['"Playfair Display"', 'serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        // Per-invitation colours arrive as CSS custom properties from the theme.
        primary: 'var(--inv-primary)',
        accent: 'var(--inv-accent)',
        surface: 'var(--inv-background)',
      },
    },
  },
  plugins: [],
};

export default config;
