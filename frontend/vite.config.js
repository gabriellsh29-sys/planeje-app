import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    // Nunca expõe o código-fonte em produção.
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Separa dependências pesadas em chunks próprios: melhora cache
        // (mudanças no app não invalidam o vendor) e permite download paralelo.
        // Vite 8 usa Rolldown, que exige manualChunks como FUNÇÃO (não objeto).
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@sentry')) return 'sentry';
          if (id.includes('recharts') || id.includes('d3-') ||
              id.includes('victory-vendor') || id.includes('recharts-scale')) return 'charts';
          if (id.includes('react-dom') || id.includes('/react/') ||
              id.includes('/react-is/') || id.includes('/scheduler/')) return 'vendor';
        },
      },
    },
  },
  // console.log/console.debug já foram removidos no código-fonte (mais explícito
  // e sem depender do minificador). console.error/console.warn são preservados
  // de propósito — observabilidade, nunca silenciar erros. A minificação padrão
  // do Vite 8 (oxc) segue ativa via build.minify.
});
