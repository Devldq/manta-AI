/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // AI: 使用 class 策略驱动暗色模式（.dark 类由 ThemeInitializer 管理）
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // AI: Manta 主题色 — CSS 变量桥接，支持 theme.config.json 驱动切换
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        border: 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        'text-inverse': 'var(--color-text-inverse)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-subtle': 'var(--color-accent-subtle)',
        'status-pending': 'var(--color-status-pending)',
        'status-running': 'var(--color-status-running)',
        'status-done': 'var(--color-status-done)',
        'status-failed': 'var(--color-status-failed)',
        'status-archived': 'var(--color-status-archived)',
        'status-planning': 'var(--color-status-planning)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
    },
  },
  plugins: [],
}
