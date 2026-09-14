import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // The terrain assets are already compressed and content-hashing them would defeat the
    // browser cache across deploys, so they stay in public/ and are copied verbatim.
    chunkSizeWarningLimit: 1500,
  },
});
