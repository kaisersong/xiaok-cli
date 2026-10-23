import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createTransportAuthorizationError } from './transport-lease.js';
const TOKENIZER = '81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99';
const WHEEL = 'cadb53a202960fc5d381f52a9c30afb0e44d7eaaa22197e851c09789bf65b83e';
const PACKAGE_FILES = {
    '__init__.py': 'e52ab6b2dff1f2e33ef24ce346191b9a046de5c25b08a8c0f873293fe640cd5d',
    '_native.abi3.so': 'a41596ca12503efa1b0a25b16d9d52293378528b3aec4f060c3814f488fdcd43',
    '_native.pyi': 'e29ea74305570acb0b5c4bfea920989d85d7795c4e80c53550a99ea6a4fd3bea',
    'py.typed': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '.dylibs/libopencv_core.4.12.0.dylib': 'ab3d89114b979a4c83143b8dfd16e81b6ef29806a76d6b7081eec5fb17120671',
    '.dylibs/libopencv_imgcodecs.4.12.0.dylib': 'd74cd4e46208a52b7c3f6b725cdc7fdb7dc1f2adbb6ebce865c3fd13cc82b02d',
    '.dylibs/libopencv_imgproc.4.12.0.dylib': 'df6052c72683a58455845031b0b6ed4c5a59ec457f30f14dc65bb764883aeab1',
};
// -I -S avoids user/site startup. Explicit path excludes cwd, zip lookups and .pth.
// Source is embedded so source and compiled distribution execute identical code.
const HELPER = `import sys\nsys.path[:] = [sys.argv[1], sys.argv[2], sys.argv[3]]\nimport json\nfrom deepseek_recipe import ChatCompletionRequest, ConversionOptions, DeepseekV41Encoding, Tokenizer\nbody = json.loads(sys.stdin.read())\nconverted = ChatCompletionRequest(body).convert(ConversionOptions())\nencoding = DeepseekV41Encoding().with_tokenizer(Tokenizer.from_file(sys.argv[4]))\nprint(json.dumps({"count": len(encoding.encode(converted.conversation))}))\n`;
const counters = new WeakMap();
function fail() { const e = createTransportAuthorizationError(); e.message += ':CAPACITY_NOT_READY'; throw e; }
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (file) => digest(readFileSync(file));
const canonical = (file) => realpathSync(path.resolve(file));
const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
function execute(exe, args, input) {
    const result = spawnSync(exe, args, { input, encoding: 'utf8', env: cleanEnv, cwd: os.tmpdir(), timeout: 15000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0 || result.signal || result.stderr.trim())
        fail();
    return result.stdout;
}
function manifestHash(m) { return digest(JSON.stringify(m)); }
/** HOST inspection only: produce a deployment snapshot for explicit host freeze.
 * No automatic install, network access, config acceptance or qualification. */
export function inspectDeepSeekRecipeEnvironment(input) {
    try {
        if (process.platform !== 'darwin' || process.arch !== 'arm64')
            fail();
        const pythonExecutable = canonical(input.pythonExecutable);
        const sitePackages = canonical(input.sitePackages);
        const tokenizerPath = canonical(input.tokenizerPath), wheelPath = canonical(input.wheelPath);
        if (fileHash(tokenizerPath) !== TOKENIZER || fileHash(wheelPath) !== WHEEL)
            fail();
        const packageRoot = path.join(sitePackages, 'deepseek_recipe');
        // Dedicated import directory: never allow a shadow json/sysconfig/etc module.
        if (JSON.stringify(readdirSync(sitePackages).sort()) !== '["deepseek_recipe"]')
            fail();
        for (const [name, sha] of Object.entries(PACKAGE_FILES))
            if (fileHash(path.join(packageRoot, name)) !== sha)
                fail();
        const info = JSON.parse(execute(pythonExecutable, ['-I', '-S', '-B', '-c', 'import sysconfig,json;print(json.dumps({"stdlib":sysconfig.get_path("stdlib"),"paths":__import__("sys").path}))']));
        const stdlib = canonical(info.stdlib);
        const absentPaths = [];
        for (const p of info.paths) {
            if (p === stdlib || p === path.join(stdlib, 'lib-dynload'))
                continue;
            try {
                statSync(p);
                fail();
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            absentPaths.push(p);
        }
        const links = [];
        const files = [];
        const directories = [];
        const seen = new Set();
        const binaries = [];
        const addFile = (file) => {
            const real = canonical(file);
            if (real !== path.resolve(file))
                links.push({ path: path.resolve(file), target: real });
            if (seen.has(real))
                return;
            seen.add(real);
            files.push({ path: real, sha256: fileHash(real) });
            if (/\.(so|dylib)$/.test(real) || real === pythonExecutable || path.basename(real) === 'Python')
                binaries.push(real);
        };
        const walk = (dir, isStdlib = false) => {
            if (lstatSync(dir).isSymbolicLink())
                fail();
            const names = readdirSync(dir).sort();
            directories.push({ path: dir, names });
            for (const name of names) {
                // This path is never included in helper sys.path. Census still binds it.
                if (isStdlib && name === 'site-packages')
                    continue;
                let target = path.join(dir, name);
                if (lstatSync(target).isSymbolicLink()) {
                    const real = canonical(target);
                    if (!statSync(real).isFile())
                        fail();
                    links.push({ path: target, target: real });
                    target = real;
                }
                if (statSync(target).isDirectory())
                    walk(target);
                else if (statSync(target).isFile())
                    addFile(target);
                else
                    fail();
            }
        };
        walk(stdlib, true);
        walk(sitePackages);
        const actualPackageFiles = files.filter(x => x.path.startsWith(packageRoot + path.sep)).map(x => path.relative(packageRoot, x.path).split(path.sep).join('/')).sort();
        if (JSON.stringify(actualPackageFiles) !== JSON.stringify(Object.keys(PACKAGE_FILES).sort()))
            fail();
        addFile(pythonExecutable);
        addFile(tokenizerPath);
        addFile(wheelPath);
        const systemLibraries = new Set();
        // Resolve each non-OS native dependency recursively; no ambient DYLD paths.
        for (let index = 0; index < binaries.length; index++) {
            const binary = binaries[index];
            const deps = execute('/usr/bin/otool', ['-L', binary]).split('\n').slice(1).map(x => x.trim().split(' (')[0]).filter(Boolean);
            const ids = execute('/usr/bin/otool', ['-D', binary]).split('\n').slice(1).map(x => x.trim());
            const load = execute('/usr/bin/otool', ['-l', binary]);
            const rpaths = [...load.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g)].map(m => m[1]);
            const expand = (p) => p.replace('@loader_path', path.dirname(binary)).replace('@executable_path', path.dirname(pythonExecutable));
            for (const dep of deps) {
                if (ids.includes(dep))
                    continue;
                if (dep.startsWith('/usr/lib/') || dep.startsWith('/System/Library/')) {
                    systemLibraries.add(dep);
                    continue;
                }
                let resolved;
                if (dep.startsWith('@rpath/')) {
                    const candidates = rpaths.map(p => path.join(expand(p), dep.slice(7))).filter(p => { try {
                        return statSync(p).isFile();
                    }
                    catch {
                        return false;
                    } });
                    if (candidates.length !== 1)
                        fail();
                    resolved = candidates[0];
                }
                else
                    resolved = expand(dep);
                if (!path.isAbsolute(resolved) || resolved.startsWith('@'))
                    fail();
                addFile(resolved);
            }
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        directories.sort((a, b) => a.path.localeCompare(b.path));
        const manifest = { recipeVersion: '0.1.1', recipeSourceReference: '8cadfede7063c896b944e7bae05daa3549ae97ea', platform: `${process.platform}-${process.arch}`, osVersion: os.version(), pythonExecutable, stdlib, sitePackages, tokenizerPath, wheelPath,
            files, directories, links, absentPaths, systemLibraries: [...systemLibraries].sort(), helperSha256: digest(HELPER) };
        return { ...manifest, sha256: manifestHash(manifest) };
    }
    catch (cause) {
        const error = createTransportAuthorizationError();
        error.message += ":CAPACITY_NOT_READY";
        error.cause = cause;
        throw error;
    }
}
function unchanged(m) {
    if (m.platform !== `${process.platform}-${process.arch}` || m.osVersion !== os.version() || m.helperSha256 !== digest(HELPER))
        fail();
    for (const link of m.links)
        if (canonical(link.path) !== link.target)
            fail();
    for (const p of m.absentPaths) {
        try {
            statSync(p);
            fail();
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    for (const entry of m.files)
        if (canonical(entry.path) !== entry.path || fileHash(entry.path) !== entry.sha256)
            fail();
    for (const entry of m.directories)
        if (lstatSync(entry.path).isSymbolicLink() || JSON.stringify(readdirSync(entry.path).sort()) !== JSON.stringify(entry.names))
            fail();
}
export function freezeDeepSeekRecipeCounter(input) {
    const actual = inspectDeepSeekRecipeEnvironment(input);
    if (!input.environmentManifest || JSON.stringify(actual) !== JSON.stringify(input.environmentManifest))
        fail();
    const cap = Object.freeze(Object.create(null));
    counters.set(cap, { manifest: actual });
    return cap;
}
export function isFrozenDeepSeekCounter(value) { return !!value && typeof value === 'object' && counters.has(value); }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(); return value; }
function keys(value, allowed) { const o = object(value); if (Object.keys(o).some(k => !allowed.includes(k)))
    fail(); return o; }
function string(value) { if (typeof value !== 'string')
    fail(); }
function textContent(value) {
    if (typeof value === 'string')
        return;
    if (!Array.isArray(value))
        fail();
    for (const part of value) {
        const p = keys(part, ['type', 'text']);
        if (p.type !== 'text')
            fail();
        string(p.text);
    }
}
function schema(value, depth = 0) {
    if (depth > 64)
        fail();
    const s = keys(value, ['type', 'properties', 'required', 'additionalProperties', 'items', 'description', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', '$defs', 'definitions', '$ref', 'title', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'format']);
    const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
    if (s.type !== undefined) {
        const values = Array.isArray(s.type) ? s.type : [s.type];
        if (values.length === 0 || values.some(v => typeof v !== 'string' || !types.includes(v)) || new Set(values).size !== values.length)
            fail();
    }
    for (const key of ['description', 'title', 'pattern'])
        if (s[key] !== undefined)
            string(s[key]);
    if (s.format !== undefined && !['date-time', 'date', 'time', 'duration', 'email', 'idn-email', 'hostname', 'idn-hostname', 'ipv4', 'ipv6', 'uri', 'uri-reference', 'iri', 'iri-reference', 'uuid', 'uri-template', 'json-pointer', 'relative-json-pointer', 'regex'].includes(s.format))
        fail();
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(v => typeof v !== 'string') || new Set(s.required).size !== s.required.length))
        fail();
    if (s.enum !== undefined && (!Array.isArray(s.enum) || s.enum.length === 0))
        fail();
    for (const key of ['minimum', 'maximum'])
        if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key])))
            fail();
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'])
        if (s[key] !== undefined && (!Number.isSafeInteger(s[key]) || s[key] < 0))
            fail();
    if (s.$ref !== undefined && (typeof s.$ref !== 'string' || !s.$ref.startsWith('#/')))
        fail();
    for (const key of ['properties', '$defs', 'definitions'])
        if (s[key] !== undefined)
            for (const child of Object.values(object(s[key])))
                schema(child, depth + 1);
    for (const key of ['items', 'additionalProperties'])
        if (s[key] !== undefined && typeof s[key] !== 'boolean')
            schema(s[key], depth + 1);
    for (const key of ['anyOf', 'oneOf', 'allOf'])
        if (s[key] !== undefined) {
            if (!Array.isArray(s[key]))
                fail();
            for (const child of s[key])
                schema(child, depth + 1);
        }
}
export function countDeepSeekSerializedRequest(counter, body) {
    const state = counters.get(counter);
    if (!state)
        fail();
    try {
        const request = keys(JSON.parse(body), ['model', 'messages', 'tools', 'stream', 'stream_options', 'max_tokens', 'thinking', 'reasoning_effort', 'tool_choice']);
        if (request.model !== 'deepseek-flash' || !Array.isArray(request.messages) || request.messages.length === 0)
            fail();
        if (request.max_tokens !== undefined && (!Number.isSafeInteger(request.max_tokens) || request.max_tokens < 1 || request.max_tokens > 393216))
            fail();
        if (request.stream !== undefined && typeof request.stream !== 'boolean')
            fail();
        if (request.stream_options !== undefined) {
            const o = keys(request.stream_options, ['include_usage']);
            if (typeof o.include_usage !== 'boolean' || request.stream !== true)
                fail();
        }
        if (request.thinking !== undefined) {
            const t = keys(request.thinking, ['type']);
            if (!['enabled', 'disabled'].includes(t.type))
                fail();
        }
        if (request.reasoning_effort !== undefined && !['none', 'low', 'high', 'max', 'minimal', 'medium', 'xhigh'].includes(request.reasoning_effort))
            fail();
        if (request.tool_choice !== undefined && !['auto', 'none', 'required'].includes(request.tool_choice))
            fail();
        for (const message of request.messages) {
            const m = object(message);
            if (m.role === 'system' || m.role === 'user') {
                keys(m, ['role', 'content']);
                textContent(m.content);
            }
            else if (m.role === 'tool') {
                keys(m, ['role', 'content', 'tool_call_id']);
                string(m.tool_call_id);
                textContent(m.content);
            }
            else if (m.role === 'assistant') {
                keys(m, ['role', 'content', 'reasoning_content', 'tool_calls']);
                if (m.content != null)
                    textContent(m.content);
                if (m.reasoning_content !== undefined)
                    string(m.reasoning_content);
                if (m.tool_calls !== undefined) {
                    if (!Array.isArray(m.tool_calls))
                        fail();
                    for (const raw of m.tool_calls) {
                        const call = keys(raw, ['id', 'type', 'function']);
                        if (call.type !== 'function')
                            fail();
                        string(call.id);
                        const f = keys(call.function, ['name', 'arguments']);
                        string(f.name);
                        string(f.arguments);
                    }
                }
            }
            else
                fail();
        }
        if (request.tools !== undefined) {
            if (!Array.isArray(request.tools))
                fail();
            for (const raw of request.tools) {
                const t = keys(raw, ['type', 'function']);
                if (t.type !== 'function')
                    fail();
                const f = keys(t.function, ['name', 'description', 'parameters']);
                string(f.name);
                if (f.description !== undefined)
                    string(f.description);
                if (f.parameters !== undefined)
                    schema(f.parameters);
            }
        }
        const m = state.manifest;
        unchanged(m);
        const output = execute(m.pythonExecutable, ['-I', '-S', '-B', '-c', HELPER, m.stdlib, path.join(m.stdlib, 'lib-dynload'), m.sitePackages, m.tokenizerPath], body);
        unchanged(m);
        const result = keys(JSON.parse(output), ['count']);
        if (!Number.isSafeInteger(result.count) || result.count < 0)
            fail();
        return result.count;
    }
    catch {
        fail();
    }
}
