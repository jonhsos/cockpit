import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    proxy: {
      "^/api(/|\\?|$)": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
