import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../docs-dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5176 },
  preview: { host: "127.0.0.1", port: 4176 },
});
