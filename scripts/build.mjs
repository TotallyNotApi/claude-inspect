// Builds the committed runtime artifacts into plugin/server/.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/proxy/main.ts'],
  outfile: 'plugin/server/proxy.mjs',
  platform: 'node',
  format: 'esm',
  bundle: true,
  target: 'node20',
  // http-proxy is CJS and uses require() of node builtins; give the ESM bundle a require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})

await build({
  entryPoints: ['src/overlay/index.ts'],
  outfile: 'plugin/server/overlay.js',
  platform: 'browser',
  format: 'iife',
  bundle: true,
  minify: true,
  target: 'es2020',
})
