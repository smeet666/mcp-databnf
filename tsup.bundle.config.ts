import { defineConfig } from "tsup";

/**
 * The build that goes inside a single-file bundle.
 *
 * A bundle is unpacked and run where it lands, with no package resolution, so
 * every dependency is compiled into the one file that ships.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  outDir: "bundle",
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  noExternal: [/.*/],
  // Some packages reach for require() at runtime, which an ESM bundle cannot
  // answer on its own.
  banner: {
    js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);",
  },
});
