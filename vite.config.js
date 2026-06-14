// vite.config.js
export default {
  root: "frontend",
  build: {
    outDir: "../dist",
    emptyOutDir: true,       // safe to wipe dist/ before each build
  },
  clearScreen: false,        // don't clear the terminal so Tauri logs remain visible
  server: {
    hmr: {
      protocol: 'ws',
      host: process.env.TAURI_DEV_HOST || 'localhost',
      port: 5173,
      clientPort: 5173,
    },
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,        // fail loudly if 5173 is taken, rather than silently picking another port
  },
  envPrefix: ["VITE_", "TAURI_"], // expose Tauri env vars to the frontend
}