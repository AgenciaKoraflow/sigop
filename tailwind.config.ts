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
        // Sidebar (sempre escura)
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
        // Cor de ação principal — azul royal
        brand: {
          DEFAULT:  '#3b5fc0',
          hover:    '#2d4fa8',
          light:    '#eff6ff',
          ring:     'rgba(59,95,192,0.15)',
        },
        // Área de conteúdo
        content: {
          bg:       '#f4f5f7',
          surface:  '#ffffff',
          border:   '#e5e7eb',
          divider:  '#f0f1f3',
        },
        // Texto
        ink: {
          DEFAULT:  '#0f172a',
          secondary:'#6b7280',
          muted:    '#9ca3af',
        },
        // Status operacional
        status: {
          'aberta-bg':       '#eff6ff',
          'aberta-text':     '#1d4ed8',
          'andamento-bg':    '#fff7ed',
          'andamento-text':  '#c2410c',
          'encerrada-bg':    '#f0fdf4',
          'encerrada-text':  '#15803d',
          'arquivada-bg':    '#f9fafb',
          'arquivada-text':  '#6b7280',
          'flagrante-bg':    '#fff1f2',
          'flagrante-text':  '#b91c1c',
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
        // Semânticos globais
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
      animation: {
        'pulse-dot': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
