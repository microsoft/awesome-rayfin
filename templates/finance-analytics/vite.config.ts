import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    // The template ships the finance component library as source under
    // `src/finance`. Dedupe React so the library components and the app share
    // one React instance (hooks/context work across the boundary).
    dedupe: ["react", "react-dom"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep the rarely-changing React runtime in its own chunk so app-code
          // deploys don't bust the framework cache.
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react-vendor";
          }
          // Force the official DataGrid dep-graph (datagrid + visuals-core,
          // Griffel, Fluent icons, TanStack virtual) into one named chunk. It's
          // only reachable via the lazy `engine="fabric"` boundary, so this
          // chunk stays async and off the initial-load budget.
          if (
            id.includes("@microsoft/fabric-datagrid") ||
            id.includes("@griffel") ||
            id.includes("@fluentui/react-icons") ||
            id.includes("@tanstack/react-virtual")
          ) {
            return "fabric-datagrid";
          }
        },
      },
    },
  },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
