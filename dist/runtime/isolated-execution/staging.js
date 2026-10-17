import { constants, closeSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeFileSync, fsyncSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { canonicalVerificationJson } from '../verification/protocol.js';
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function filePath(value) {
    if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f:]/.test(part)))
        throw Error('staging_file_scope');
    return value;
}
function readAnchoredBytes(workspace, path, limit, executable) {
    if (!['darwin', 'linux'].includes(process.platform))
        throw Error('staging_atomic_open_unavailable');
    const identity = lstatSync(workspace, { bigint: true });
    const result = spawnSync(executable, [workspace, path, String(limit), String(identity.dev), String(identity.ino)], {
        cwd: '/', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 16 * 1024 ** 2 + 4096,
    });
    if (result.error || result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout) || result.stdout.length > limit)
        throw Error('staging_secure_read_failed');
    return result.stdout;
}
/** Real file freezing primitive. Only its installed controller owner may attach authorization and engine qualification. */
export function createInputStager(options) {
    if (!['darwin', 'linux'].includes(process.platform))
        throw Error('staging_atomic_open_unavailable');
    if (typeof options.readerExecutable !== 'string' || !isAbsolute(options.readerExecutable) || options.readerExecutable.includes('\0'))
        throw Error('staging_reader_path');
    const readerExecutable = options.readerExecutable;
    const access = Object.freeze({ assertLive: options.access.assertLive, assertRead: options.access.assertRead });
    if (typeof access.assertLive !== 'function' || typeof access.assertRead !== 'function')
        throw Error('staging_access_contract');
    const synchronous = (result) => {
        if (result === undefined)
            return;
        // Rejected asynchronous decisions must neither authorize bytes nor leak an unhandled rejection.
        if (result && (typeof result === 'object' || typeof result === 'function'))
            void Promise.resolve(result).catch(() => { });
        throw Error('staging_access_must_be_synchronous_void');
    };
    const assertLive = (grant) => synchronous(access.assertLive(grant));
    const assertRead = (grant, file) => synchronous(access.assertRead(grant, file));
    const maximumBytes = options.maximumStagedBytes ?? 256 * 1024 ** 2;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 256 * 1024 ** 2)
        throw Error('staging_budget');
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink())
        throw Error('staging_root');
    const root = realpathSync(options.root), identity = lstatSync(root);
    const plans = new WeakMap();
    function assertRoot() { const stat = lstatSync(root); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino)
        throw Error('staging_root'); }
    function usage() {
        assertRoot();
        let bytes = 0, count = 0;
        const visit = (path, depth) => {
            if (depth > 64 || ++count > 100000)
                throw Error('staging_budget');
            const stat = lstatSync(path);
            if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)))
                throw Error('staging_root');
            if (stat.isDirectory())
                for (const name of readdirSync(path))
                    visit(join(path, name), depth + 1);
            else if ((bytes += stat.size) > maximumBytes)
                throw Error('staging_budget');
        };
        visit(root, 0);
        return bytes;
    }
    return Object.freeze({
        prepareValidationInput(input) {
            const grant = input.grant;
            // Snapshot host proposal before invoking any per-file authority callback.
            const proposal = JSON.parse(canonicalVerificationJson({ workspaceRoot: input.workspaceRoot, files: input.files, purpose: input.purpose, ...(input.editedFile === undefined ? {} : { editedFile: input.editedFile }), invocation: input.invocation, command: input.command }));
            assertLive(grant);
            if (!['isolated-validation', 'isolated-command'].includes(proposal.purpose) || (proposal.purpose === 'isolated-command' && proposal.editedFile !== undefined) || (proposal.purpose === 'isolated-validation' && !proposal.editedFile))
                throw Error('staging_purpose');
            if (!Array.isArray(proposal.files) || proposal.files.length > 4096)
                throw Error('staging_budget');
            const edited = proposal.editedFile ? filePath(proposal.editedFile.path) : undefined;
            if (edited && !proposal.files.some(file => file.path === edited))
                throw Error('staging_edited_file_missing');
            if (!Array.isArray(proposal.command.argv) || !proposal.command.argv.length || proposal.command.argv.length > 256 || proposal.command.argv.some(value => typeof value !== 'string' || value.includes('\0')) || Buffer.byteLength(JSON.stringify(proposal.command.argv)) > 128 * 1024)
                throw Error('staging_command');
            const cwd = proposal.command.cwdRelative === '.' ? '.' : filePath(proposal.command.cwdRelative);
            if (!proposal.invocation || Object.keys(proposal.invocation).sort().join(',') !== 'compoundOperationId,sessionIdentity,validationInvocationId')
                throw Error('staging_invocation');
            for (const value of Object.values(proposal.invocation))
                if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 160 || /[\0\r\n]/.test(value))
                    throw Error('staging_invocation');
            const requestedWorkspace = resolve(proposal.workspaceRoot);
            if (lstatSync(requestedWorkspace).isSymbolicLink() || !lstatSync(requestedWorkspace).isDirectory())
                throw Error('staging_source_link');
            const workspace = realpathSync(requestedWorkspace);
            const underWorkspace = relative(workspace, root);
            if (underWorkspace === '' || (!isAbsolute(underWorkspace) && underWorkspace !== '..' && !underWorkspace.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))))
                throw Error('staging_recursive_root');
            const names = new Set();
            let allocated = usage();
            const directory = join(root, randomUUID());
            mkdirSync(directory, { mode: 0o700 });
            const files = [];
            for (const file of proposal.files) {
                const path = filePath(file.path);
                if (names.has(path.toLowerCase()))
                    throw Error('staging_file_alias');
                names.add(path.toLowerCase());
                if (!/^[a-f0-9]{64}$/.test(file.expectedContentHash) || !Number.isSafeInteger(file.byteLimit) || file.byteLimit < 0 || file.byteLimit > 16 * 1024 ** 2)
                    throw Error('staging_file_limit');
                let source = workspace;
                for (const part of path.split('/')) {
                    source = join(source, part);
                    if (lstatSync(source).isSymbolicLink())
                        throw Error('staging_source_link');
                }
                assertRead(grant, Object.freeze({ canonicalPath: source, expectedContentHash: file.expectedContentHash, byteLimit: file.byteLimit }));
                const before = lstatSync(source);
                if (!before.isFile() || before.nlink !== 1)
                    throw Error('staging_source_link');
                if (before.size > file.byteLimit || allocated + before.size > maximumBytes)
                    throw Error('staging_budget');
                const bytes = readAnchoredBytes(workspace, path, file.byteLimit, readerExecutable);
                const after = lstatSync(source);
                if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || bytes.length !== before.size || digest(bytes) !== file.expectedContentHash)
                    throw Error('staging_content_changed');
                assertLive(grant);
                const target = join(directory, String(files.length));
                const targetFd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o400);
                try {
                    writeFileSync(targetFd, bytes);
                    fsyncSync(targetFd);
                }
                finally {
                    closeSync(targetFd);
                }
                allocated += bytes.length;
                files.push(Object.freeze({ path, contentHash: file.expectedContentHash, size: bytes.length, executable: (before.mode & 0o111) !== 0 }));
            }
            if (edited && files.find(file => file.path === edited)?.contentHash !== proposal.editedFile.afterHash)
                throw Error('staging_content_changed');
            const command = Object.freeze({ argv: Object.freeze([...proposal.command.argv]), cwdRelative: cwd });
            const scopeDigest = digest(canonicalVerificationJson({ purpose: proposal.purpose, ...(proposal.editedFile ? { editedFile: proposal.editedFile } : {}), invocation: proposal.invocation, command, files }));
            syncDirectoryTreeStrict(directory);
            usage();
            assertLive(grant);
            const plan = Object.freeze({});
            plans.set(plan, { invocation: Object.freeze({ ...proposal.invocation }), directory, grant, files: Object.freeze(files), scopeDigest, command });
            return Object.freeze({ materializedInput: plan, command, scopeDigest });
        },
        readFile(plan, path) {
            const record = plans.get(plan);
            if (!record)
                throw Error('staging_plan_identity');
            assertLive(record.grant);
            assertRoot();
            const index = record.files.findIndex(file => file.path === path);
            if (index < 0)
                throw Error('staging_file_scope');
            const source = join(record.directory, String(index));
            const stat = lstatSync(source);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== record.files[index].size)
                throw Error('staging_content_changed');
            const bytes = readAnchoredBytes(record.directory, String(index), record.files[index].size, readerExecutable);
            if (digest(bytes) !== record.files[index].contentHash)
                throw Error('staging_content_changed');
            assertLive(record.grant);
            return bytes;
        },
        getManifest(plan) {
            const record = plans.get(plan);
            if (!record)
                throw Error('staging_plan_identity');
            assertLive(record.grant);
            assertRoot();
            return Object.freeze({ invocation: record.invocation, files: record.files, scopeDigest: record.scopeDigest, command: record.command });
        },
    });
}
