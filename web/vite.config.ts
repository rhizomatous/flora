import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(async ({ mode, command }) => {
  const preview =
    mode === "chat-preview" && command === "serve"
      ? await import("../scripts/preview/server.ts")
      : undefined;
  return {
    publicDir: "../florets/src/assets",
    plugins: [react(), tailwindcss(), ...(preview ? [preview.chatPreview()] : [])],
    build: {
      outDir: "../backend/internal/webassets/dist",
      emptyOutDir: true,
    },
    server: {
      proxy: mode === "chat-preview" ? {} : { "/api": "http://127.0.0.1:8080" },
    },
  };
});
