import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = Number(process.env.LLAMREI_PORT ?? 4321);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'apk-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && (req.url.endsWith('.apk') || req.url.includes('/download/'))) {
            res.setHeader('Content-Type', 'application/vnd.android.package-archive');
            res.setHeader('Content-Disposition', 'attachment; filename="llamrei-widgets.apk"');
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
