import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    index: "server/index.ts",
    worker: "server/worker.ts",
    seed: "prisma/seed.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist/server",
  external: ["vite"],
  clean: true,
  splitting: true,
});
