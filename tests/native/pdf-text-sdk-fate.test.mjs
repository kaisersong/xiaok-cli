import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(join(repo, 'package.json'));
function fixturePdf() {
  const content = 'BT /F1 18 Tf 1 0 0 1 40 700 Tm (Actual PDF raw SDK) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const at = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(pdf);
}
for (const mode of [
  'cleanup-held',
  'cleanup-undefined-held',
  'body-and-cleanup',
  'body-error-held',
  'task-promise-getter',
])
  test('original PDF SDK fate: ' + mode, { timeout: 15000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-pdf-sdk-fate-'));
    mkdirSync(join(root, 'config'), { mode: 0o700 });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    symlinkSync(join(repo, 'desktop/node_modules'), join(root, 'node_modules'));
    const gate = new SharedArrayBuffer(8),
      flags = new Int32Array(gate),
      entry = join(root, 'worker.mjs');
    await require('esbuild').build({
      entryPoints: [join(repo, 'desktop/electron/pdf-text-worker.ts')],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      plugins: [
        {
          name: 'original-sdk-after-call-fault',
          setup(build) {
            build.onLoad({ filter: /pdf-text-body\.ts$/ }, (args) => {
              let text = readFileSync(args.path, 'utf8');
              const point =
                'const value = apply(shell.fn, namespace, [{ data: bytes }]);';
              assert.ok(
                text.includes(point),
                'actual original getDocument seam exists',
              );
              text =
                "import {parentPort as sdkPort,workerData as sdkData} from 'node:worker_threads';\n" +
                text.replace(
                  point,
                  point +
                    `
  if(sdkData.mode==='task-promise-getter')Object.defineProperty(value,'promise',{get(){Atomics.add(new Int32Array(sdkData.gate),1,1);throw Error('getter must remain inert');}});
  const originalDestroy=dataMethod(value,'destroy');
  Object.defineProperty(value,'destroy',{value:function(...args){
   const raw=apply(originalDestroy,this,args); // actual PDFJS cleanup first
   sdkPort.postMessage({kind:'fixture-cleanup-entered'});
   const held=Atomics.waitAsync(new Int32Array(sdkData.gate),0,0).value;
   if(sdkData.mode==='body-error-held')return raw;
   if(sdkData.mode==='cleanup-held'){Object.defineProperty(raw,Symbol('actual cleanup raw tail'),{value:held});return raw;}
   const failed=apply(then,raw,[()=>{throw undefined;}]);
   Object.defineProperty(failed,Symbol('actual cleanup outcome tail'),{value:held});return failed;
  },configurable:true});
  `,
                );
              if (mode === 'body-and-cleanup' || mode === 'body-error-held') {
                const method = 'const fn = dataMethod(resource, name);';
                assert.ok(text.includes(method));
                text = text.replace(
                  method,
                  `let fn=dataMethod(resource,name);if(name==='getTextContent'){const original=fn;fn=function(...args){const raw=apply(original,this,args);return apply(then,raw,[()=>{const error=Error('original_body_cause');if(sdkData.mode==='body-error-held'){const held=Atomics.waitAsync(new Int32Array(sdkData.gate),0,0).value;Object.defineProperty(error,'stack',{value:held});Object.defineProperty(error,Symbol('original outcome error tail'),{value:held});Object.defineProperty(error,'opaque',{get(){Atomics.add(new Int32Array(sdkData.gate),1,1);throw Error('forbidden getter');}});}throw error;}]);};}`,
                );
              }
              return {
                contents: text,
                loader: 'ts',
                resolveDir: dirname(args.path),
              };
            });
          },
        },
      ],
    });
    const worker = new Worker(entry, {
      workerData: { mode, gate },
      env: { ...process.env, XIAOK_CONFIG_DIR: join(root, 'config') },
    });
    let result;
    let onCleanup;
    const cleanupEntered = new Promise((yes) => {
      onCleanup = yes;
    });
    const messages = [];
    worker.on('message', (value) => {
      messages.push(value);
      if (value.kind === 'fixture-cleanup-entered') onCleanup();
      else result = value;
    });
    const exited = new Promise((yes, no) => {
      worker.once('error', no);
      worker.once('exit', (code) => yes(code));
    });
    try {
      worker.postMessage(
        JSON.stringify({
          kind: 'original_pdf_request_v1',
          bytesBase64: fixturePdf().toString('base64'),
        }),
      );
      await cleanupEntered;
      await new Promise((yes) => setTimeout(yes, 20));
      assert.equal(
        result,
        undefined,
        'logical reply must retain actual cleanup symbol tail',
      );
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      assert.equal(await exited, 0);
      assert.equal(Atomics.load(flags, 1), 0);
      if (mode === 'cleanup-held')
        assert.deepEqual(result, {
          kind: 'original_pdf_text_v1',
          text: 'Actual PDF raw SDK',
        });
      else if (mode === 'cleanup-undefined-held')
        assert.equal(result.errorUndefined, true);
      else if (mode === 'task-promise-getter')
        assert.equal(result.kind, 'original_pdf_error_v1');
      else assert.equal(result.error, 'original_body_cause');
      writeFileSync(
        join(root, 'facts.json'),
        JSON.stringify({
          mode,
          messages,
          exitCode: 0,
          notNativeAuthorization: true,
        }),
      );
      console.log(
        JSON.stringify({
          root,
          mode,
          exitCode: 0,
          notNativeAuthorization: true,
        }),
      );
    } finally {
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      await worker.terminate();
    }
  });
