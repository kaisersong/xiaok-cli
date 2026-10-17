// Runs only inside Seatbelt. Expectations stay in the parent, never here.
const fs = require('node:fs');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync(process.argv[2], 'utf8');
const actual = input.vectors.map(rows => {
 const context = vm.createContext(undefined, {codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(`for (const key of ['ArrayBuffer','SharedArrayBuffer','DataView','Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float16Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','WebAssembly']) globalThis[key]=undefined;`,context,{timeout:200});
 const program = `const module = { exports: null };\n${source}\nmodule.exports(${JSON.stringify(rows)});`;
 const result=vm.runInContext(program,context,{timeout:200});
 if(typeof result!=='number'||!Number.isFinite(result))throw Error('numeric result required');
 return result;
});
process.stdout.write(JSON.stringify({nonce:input.nonce,actual}));
