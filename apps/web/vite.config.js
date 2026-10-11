import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL || "http://localhost:8080";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api, "/media": api, "/sitemap.xml": api, "/robots.txt": api } },
  build: { outDir: "dist", sourcemap: false },
});
