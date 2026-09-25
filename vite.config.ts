import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webApi } from "./src/web-api.ts";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "kite-local-api",
      configureServer: (server) => {
        server.middlewares.use(webApi);
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(webApi);
      },
    },
  ],
  server: { host: "127.0.0.1", port: 7055, strictPort: true, allowedHosts: ["kite.dev.hexly.ai"] },
  preview: { host: "127.0.0.1", port: 7055, strictPort: true, allowedHosts: ["kite.dev.hexly.ai"] },
  build: { outDir: "dist/web" },
});
