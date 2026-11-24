import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tauri expects the dev server on a fixed loopback port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
