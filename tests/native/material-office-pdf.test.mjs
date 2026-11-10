import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(join(repo, 'package.json'));
for (const mode of [
  'office-entered',
  'office-pre-spawn-negative',
  'office-pre-spawn-held',
  'office-foreign-parent',
  'office-post-revoked',
  'pending-no-source',
  'pdf-entered',
])
  test(
    'actual original material Office/PDF leaf owns Native P through ' + mode,
    { skip: process.platform !== 'darwin', timeout: 90000 },
    async () => {
      const root = mkdtempSync(
          join(tmpdir(), 'xiaok-native-process-composition-'),
        ),
        domain = join(root, 'domain'),
        addon = join(root, 'root_resource_authority_main.node'),
        bundle = join(root, 'component.mjs');
      mkdirSync(domain);
      const { deflateRawSync } = await import('node:zlib');
      const parts = [
        [
          '[Content_Types].xml',
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ],
        [
          '_rels/.rels',
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ],
        [
          'word/document.xml',
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Actual original Office file</w:t></w:r></w:p></w:body></w:document>',
        ],
      ];
      const locals = [],
        centrals = [];
      let offset = 0;
      function crc32(data) {
        let crc = 0xffffffff;
        for (const value of data) {
          crc ^= value;
          for (let i = 0; i < 8; i++)
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
        return (crc ^ 0xffffffff) >>> 0;
      }
      for (const [name, text] of parts) {
        const n = Buffer.from(name),
          data = Buffer.from(text),
          packed = deflateRawSync(data),
          crc = crc32(data),
          local = Buffer.alloc(30),
          central = Buffer.alloc(46);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(n.length, 26);
        centrals.push(central, n);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(n.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, n, packed);
        offset += 30 + n.length + packed.length;
      }
      const central = Buffer.concat(centrals),
        end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(parts.length, 8);
      end.writeUInt16LE(parts.length, 10);
      end.writeUInt32LE(central.length, 12);
      end.writeUInt32LE(offset, 16);
      writeFileSync(
        join(domain, 'actual.docx'),
        Buffer.concat([...locals, central, end]),
      );
      const content =
        'BT /F1 18 Tf 1 0 0 1 40 700 Tm (Actual original PDF file) Tj ET';
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
      const xref = Buffer.byteLength(pdf);
      pdf +=
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)
          .join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      writeFileSync(join(domain, 'actual.pdf'), pdf);
      writeFileSync(
        join(root, 'office-parser-worker.mjs'),
        readFileSync(join(repo, 'desktop/electron/office-parser-worker.mjs')),
      );

      const build = spawnSync(
        process.execPath,
        [
          join(repo, 'native/root-resource-authority/build-main-session.mjs'),
          process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
          addon,
          domain,
          'embedded',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(build.status, 0, build.stderr || build.stdout);
      await require('esbuild').build({
        entryPoints: [
          join(repo, 'tests/native/fixtures/material-office-pdf-entry.ts'),
        ],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        banner: {
          js: "import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);",
        },
      });
      if (mode === 'pdf-entered')
        await require('esbuild').build({
          entryPoints: [join(repo, 'desktop/electron/pdf-text-worker.ts')],
          outfile: join(root, 'pdf-text-worker.js'),
          bundle: true,
          platform: 'node',
          format: 'esm',
          packages: 'external',
        });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      if (mode.startsWith('delivery'))
        for (const worker of [
          'delivery-verifier-worker',
          'protection-read-worker',
        ])
          await require('esbuild').build({
            entryPoints: [join(repo, 'src/runtime/task-host', worker + '.ts')],
            outfile: join(root, worker + '.js'),
            bundle: true,
            platform: 'node',
            format: 'esm',
            packages: 'external',
            banner: {
              js: "import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);",
            },
          });
      writeFileSync(
        join(root, 'glob-worker.mjs'),
        readFileSync(join(repo, 'src/ai/tools/glob-worker.mjs')),
      );
      writeFileSync(
        join(root, 'search-scope.mjs'),
        readFileSync(join(repo, 'src/ai/tools/search-scope.mjs')),
      );
      symlinkSync(
        join(repo, 'desktop/node_modules'),
        join(root, 'node_modules'),
      );
      const electron = await getNativeTestElectronExecutable(repo),
        result = join(root, 'facts.json'),
        env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.ELECTRON_RUN_AS_NODE;
      const args = [
        join(repo, 'tests/native/fixtures/material-office-pdf.cjs'),
        bundle,
        domain,
        result,
        join(root, 'userData'),
        resolve(repo, '../intent-broker/src/broker/service.js'),
        resolve(repo, '../intent-broker/src/http/server.js'),
        mode,
      ];
      const child = spawn(electron, args, {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
        row = {
          pid: child.pid,
          argv: [electron, ...args],
          signals: [],
          stdout: '',
          stderr: '',
        };
      row.birth = spawnSync('ps', ['-p', String(child.pid), '-o', 'lstart='], {
        encoding: 'utf8',
      }).stdout.trim();
      writeFileSync(join(root, 'birth.json'), JSON.stringify(row, null, 2));
      child.stdout.on('data', (v) => {
        row.stdout += v;
      });
      child.stderr.on('data', (v) => {
        row.stderr += v;
      });
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          row.signals.push('SIGTERM');
          child.kill('SIGTERM');
        }
      }, 45000);
      try {
        await new Promise((yes, no) => {
          child.once('error', no);
          child.once('close', (code, signal) => {
            row.code = code;
            row.signal = signal;
            row.reaped = true;
            yes();
          });
        });
      } finally {
        clearTimeout(timer);
        writeFileSync(join(root, 'run.json'), JSON.stringify(row, null, 2));
      }
      console.log(JSON.stringify({ root, ...row }));
      assert.equal(row.code, 0, row.stderr);
      assert.deepEqual(row.signals, []);
      const facts = JSON.parse(readFileSync(result, 'utf8'));
      assert.equal(facts.pid, child.pid);
      assert.equal(facts.ok, true, JSON.stringify(facts));
      assert.equal(facts.wholeDomainKnown, false);
      if (mode === 'office-entered' || mode === 'pdf-entered') {
        const held = JSON.parse(
          readFileSync(join(domain, 'native-port-drain.json'), 'utf8'),
        );
        assert.equal(held.settled, false);
      }
    },
  );
