import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port. In dev, API calls go straight to the
// Bin It server on :7878 (see src/api.ts), so no proxy is needed. `host: true` listens on
// the LAN too, so a phone on the same wifi can open http://<this PC>:1420 while developing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: true },
  build: { target: "es2022", outDir: "dist" },
});
