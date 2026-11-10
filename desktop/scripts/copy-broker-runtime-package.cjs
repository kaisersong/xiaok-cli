'use strict';
const {mkdirSync, copyFileSync} = require('node:fs');
const {join, resolve} = require('node:path');
const root = resolve(__dirname, '..');
const output = join(root, 'dist', 'main', 'desktop');
for (const dir of ['electron', 'resources']) mkdirSync(join(output, dir), {recursive: true});
for (const name of ['broker-runtime-package.cjs', 'broker-runtime-file.cjs']) copyFileSync(join(root, 'electron', name), join(output, 'electron', name));
copyFileSync(join(root, 'resources', 'broker-runtime-lock.json'), join(output, 'resources', 'broker-runtime-lock.json'));
