import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Gera um único index.html (JS e CSS embutidos) que abre com duplo clique no Windows.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
});
