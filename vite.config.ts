import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    proxy: {
      "/bridge": "http://127.0.0.1:18700",
      "/healthz": "http://127.0.0.1:18700",
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", minify: "esbuild", sourcemap: false },
});
