export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Paleta Planeje — brand guide oficial
        bg:       '#0f172a',
        surface:  '#1e293b',
        card:     '#1e293b',
        'card-2': '#243044',
        // Verde primário
        accent:     '#22c55e',
        'accent-2': '#16a34a',
        'accent-3': '#15803d',
        // Mantém gold como cor de ação secundária
        gold:        '#22c55e',
        'gold-light':'#4ade80',
        'gold-dark': '#16a34a',
        // Financeiro
        income:  '#22c55e',
        expense: '#f43f5e',
        blue:    '#3b82f6',
        muted:   '#64748b',
        // Texto — tudo branco
        'text-1': '#ffffff',
        'text-2': '#ffffff',
        'text-3': '#ffffff',
        border:   'rgba(34,197,94,0.12)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-accent':  '0 0 24px rgba(34,197,94,0.2)',
        'glow-green':   '0 0 24px rgba(34,197,94,0.2)',
        'glow-gold':    '0 0 24px rgba(34,197,94,0.2)',
        'glow-income':  '0 0 24px rgba(34,197,94,0.15)',
        'glow-expense': '0 0 24px rgba(244,63,94,0.15)',
        'card':         '0 4px 24px rgba(0,0,0,0.5)',
        'card-lg':      '0 8px 40px rgba(0,0,0,0.6)',
        'inner-glow':   'inset 0 1px 0 rgba(34,197,94,0.08)',
      },
      backgroundImage: {
        'gradient-card':    'linear-gradient(135deg, #1e293b 0%, #1a2540 100%)',
        'gradient-accent':  'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
        'gradient-surface': 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        'gradient-glow':    'radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.08) 0%, transparent 70%)',
        'gradient-gold':    'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
      },
      keyframes: {
        'fade-in':  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer:    { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in':  'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        shimmer:    'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
