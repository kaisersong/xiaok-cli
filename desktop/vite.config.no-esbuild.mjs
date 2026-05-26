import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version ?? '0.0.0';

function typescriptTransform() {
  return {
    name: 'typescript-transform-no-esbuild',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules')) return null;
      if (!/\.[cm]?[jt]sx?(?:\?.*)?$/.test(id)) return null;
      const cleanId = id.split('?')[0];
      const replaced = code
        .replace(/\b__APP_VERSION__\b/g, JSON.stringify(packageVersion))
        .replace(/\b__APP_BUILD__\b/g, JSON.stringify('local'));
      const result = ts.transpileModule(replaced, {
        fileName: cleanId,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
          sourceMap: true,
          useDefineForClassFields: true,
        },
      });
      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
}

function nodeEnvTransform() {
  return {
    name: 'node-env-transform-no-esbuild',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?(?:\?.*)?$/.test(id)) return null;
      if (!code.includes('process.env') && !code.includes('import.meta.env') && !code.includes('import.meta.hot')) return null;
      const replaced = code
        .replace(/\bimport\.meta\.hot\b/g, 'undefined')
        .replace(/\bimport\.meta\.env\.DEV\b/g, 'false')
        .replace(/\bimport\.meta\.env\.PROD\b/g, 'true')
        .replace(/\bimport\.meta\.env\.SSR\b/g, 'false')
        .replace(/\bimport\.meta\.env\b/g, '{}')
        .replace(/\bglobalThis\.process\.env\.NODE_ENV\b/g, JSON.stringify('production'))
        .replace(/\bglobal\.process\.env\.NODE_ENV\b/g, JSON.stringify('production'))
        .replace(/\bprocess\.env\.NODE_ENV\b/g, JSON.stringify('production'))
        .replace(/\bglobalThis\.process\.env\b/g, '{}')
        .replace(/\bglobal\.process\.env\b/g, '{}')
        .replace(/\bprocess\.env\b/g, '{}');
      return replaced === code ? null : { code: replaced, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  root: 'renderer',
  esbuild: false,
  keepProcessEnv: true,
  plugins: [nodeEnvTransform(), typescriptTransform(), tailwindcss()],
  define: {},
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      treeshake: false,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'renderer/src'),
      '@xiaok/shared': resolve(__dirname, 'renderer/src/shared'),
    },
  },
  optimizeDeps: {
    include: ['react-router-dom'],
  },
});
