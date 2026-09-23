import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    plugins: [react(), tailwindcss()],
    root: 'web',
    server: {
        proxy: {
            '/api/': 'http://127.0.0.1:3000',
        },
    },
    build: { outDir: '../dist/cloud', emptyOutDir: true },
});
