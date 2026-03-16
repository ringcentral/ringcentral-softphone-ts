import { globSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { defineConfig } from 'rollup';
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import pkg from './package.json' with { type: 'json' };

const input = Object.fromEntries(
  globSync('src/**/*.ts').map((file) => [
    file.replace(/^src\//, '').replace(/\.ts$/, ''),
    file,
  ]),
);

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

const external = [...Object.keys(pkg.dependencies), ...builtins];

export default defineConfig([
  {
    input,
    output: {
      dir: 'dist/esm',
      format: 'esm',
      entryFileNames: '[name].mjs',
      sourcemap: true,
      preserveModules: true,
    },
    external,
    treeshake: { moduleSideEffects: false }, // no extra imports because of the barrel files
    plugins: [esbuild({ target: 'esnext' })],
  },
  {
    input,
    output: {
      dir: 'dist/esm',
      format: 'esm',
      entryFileNames: '[name].d.mts',
      sourcemap: true,
      preserveModules: true,
    },
    external,
    plugins: [dts({ sourcemap: true })],
  },
  {
    input,
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      entryFileNames: '[name].cjs',
      sourcemap: true,
      preserveModules: true,
    },
    external,
    treeshake: { moduleSideEffects: false }, // no extra imports because of the barrel files
    plugins: [esbuild({ target: 'esnext' })],
  },
  {
    input,
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      entryFileNames: '[name].d.cts',
      sourcemap: true,
      preserveModules: true,
    },
    external,
    plugins: [dts({ sourcemap: true })],
  },
]);
