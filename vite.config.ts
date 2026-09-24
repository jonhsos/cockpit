import { defineConfig } from "vite";

const targetPort = process.env.COCKPIT_PORTA || process.env.COCKPIT_PORT || process.env.PORT || "3000";
const targetHost = process.env.COCKPIT_HOST || process.env.HOST || "localhost";
const targetUrl = `http://${targetHost}:${targetPort}`;
const targetWs = `ws://${targetHost}:${targetPort}`;

export default defineConfig({
  root: "web",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    proxy: {
      "^/api(/|\\?|$)": targetUrl,
      "/ws": { target: targetWs, ws: true },
    },
  },
});
