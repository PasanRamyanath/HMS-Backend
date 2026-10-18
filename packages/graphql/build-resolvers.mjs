/**
 * @hms/graphql - AppSync JS Bundler
 * Compiles all AppSync JS resolvers to standalone ES6 modules (APPSYNC_JS_1_0_0).
 */

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resolversDir = resolve(__dirname, "resolvers");
const outdir = resolve(__dirname, "dist", "resolvers");

const entryFiles = readdirSync(resolversDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"))
  .map((f) => join(resolversDir, f));

await build({
  entryPoints: entryFiles,
  outdir,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  external: ["@aws-appsync/utils", "@aws-appsync/utils/*"],
  sourcemap: false,
  minify: false,
  treeShaking: true,
});

process.stdout.write(
  `Successfully bundled ${entryFiles.length} AppSync JS resolvers to ${outdir}\n`,
);
