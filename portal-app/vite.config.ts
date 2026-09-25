import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Build para dist/, servido pelo backend em /portal/:slug. Sem code splitting:
// o portal inteiro é menor que um chunk do painel, e um arquivo só evita
// requisição extra em rede ruim.
export default defineConfig({
  plugins: [preact()],
  base: '/portal-assets/',
  build: {
    outDir: 'dist',
    assetsDir: '.',
    rollupOptions: { output: { manualChunks: undefined } },
  },
})
