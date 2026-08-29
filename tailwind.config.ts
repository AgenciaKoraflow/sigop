import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ---------------------------------------------------------------
        // Shadcn/UI — tokens (base color: Slate, CSS variables)
        // Consumed by the components in components/ui.
        // ---------------------------------------------------------------
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },

        // ---------------------------------------------------------------
        // SIGOP design system
        // ---------------------------------------------------------------
        // Sidebar (always dark)
        sidebar: {
          DEFAULT:  '#0a0f1e',
          mid:      '#0d1526',
          hover:    '#1a2744',
          active:   '#1e3a6e',
          border:   '#3b5fc0',
          text:     '#ffffff',
          muted:    '#8892a4',
          icon:     '#6b7fa8',
        },
        // Primary action color — royal blue
        brand: {
          DEFAULT:  '#3b5fc0',
          hover:    '#2d4fa8',
          light:    '#eff6ff',
          ring:     'rgba(59,95,192,0.15)',
        },
        // Content area
        content: {
          bg:       '#f4f5f7',
          surface:  '#ffffff',
          border:   '#e5e7eb',
          divider:  '#f0f1f3',
        },
        // Text
        ink: {
          DEFAULT:  '#0f172a',
          secondary:'#6b7280',
          muted:    '#9ca3af',
        },
        // Operational status
        status: {
          'open-bg':            '#eff6ff',
          'open-text':          '#1d4ed8',
          'in-progress-bg':     '#fff7ed',
          'in-progress-text':   '#c2410c',
          'closed-bg':          '#f0fdf4',
          'closed-text':        '#15803d',
          'archived-bg':        '#f9fafb',
          'archived-text':      '#6b7280',
          'in-flagrante-bg':    '#fff1f2',
          'in-flagrante-text':  '#b91c1c',
        },
        // Sync status (offline-first)
        sync: {
          'draft-bg':      '#f9fafb',
          'draft-text':    '#6b7280',
          'pending-bg':    '#fff7ed',
          'pending-text':  '#c2410c',
          'syncing-bg':    '#eff6ff',
          'syncing-text':  '#1d4ed8',
          'synced-bg':     '#f0fdf4',
          'synced-text':   '#15803d',
          'error-bg':      '#fff1f2',
          'error-text':    '#b91c1c',
          'conflict-bg':   '#fefce8',
          'conflict-text': '#a16207',
        },
        // KPI card icons
        kpi: {
          'pending-bg':   '#fff7ed',
          'pending-icon': '#f97316',
          'running-bg':   '#eff6ff',
          'running-icon': '#3b82f6',
          'done-bg':      '#f0fdf4',
          'done-icon':    '#22c55e',
          'total-bg':     '#eff6ff',
          'total-icon':   '#3b82f6',
          'backlog-bg':    '#fff1f2',
          'backlog-icon':  '#ef4444',
          'sla-bg':       '#f0fdf4',
          'sla-icon':     '#22c55e',
        },
        // Global semantic colors
        success:  '#16a34a',
        warning:  '#d97706',
        danger:   '#dc2626',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        'kpi-label': ['11px', { lineHeight: '1', letterSpacing: '0.08em', fontWeight: '600' }],
        'kpi-value': ['30px', { lineHeight: '1.1', fontWeight: '700' }],
        'nav-section': ['10px', { lineHeight: '1', letterSpacing: '0.12em', fontWeight: '600' }],
      },
      borderRadius: {
        // Shadcn/UI
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // SIGOP
        card:   '12px',
        input:  '8px',
        badge:  '999px',
        icon:   '10px',
      },
      boxShadow: {
        card:   '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        modal:  '0 10px 40px rgba(0,0,0,0.12)',
        focus:  '0 0 0 3px rgba(59,95,192,0.15)',
      },
      width: {
        sidebar: '280px',
      },
      height: {
        topbar: '56px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'pulse-dot': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
