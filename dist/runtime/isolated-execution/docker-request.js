import { createHash } from 'node:crypto';
/** Fixed OCI policy; changing it changes qualification identity and requires new escape tests. */
const allowedSyscalls = [
    'read', 'write', 'readv', 'writev', 'pread64', 'pwrite64', 'preadv', 'pwritev', 'close', 'close_range',
    'open', 'openat', 'openat2', 'creat', 'fcntl', 'fcntl64', 'flock', 'fstat', 'fstat64', 'newfstatat', 'stat', 'lstat', 'statx',
    'lseek', '_llseek', 'getdents', 'getdents64', 'readlink', 'readlinkat', 'access', 'faccessat', 'faccessat2',
    'mmap', 'mmap2', 'munmap', 'mprotect', 'mremap', 'madvise', 'brk', 'msync', 'mincore',
    'rt_sigaction', 'rt_sigprocmask', 'rt_sigreturn', 'rt_sigsuspend', 'rt_sigtimedwait', 'sigaltstack', 'restart_syscall',
    'futex', 'futex_waitv', 'set_robust_list', 'get_robust_list', 'set_tid_address', 'rseq',
    'clock_gettime', 'clock_getres', 'clock_nanosleep', 'gettimeofday', 'time', 'nanosleep', 'times',
    'getpid', 'getppid', 'gettid', 'getuid', 'geteuid', 'getgid', 'getegid', 'getgroups',
    'getresuid', 'getresgid', 'getpgid', 'getpgrp', 'getpriority', 'sched_yield', 'sched_getaffinity', 'sched_getparam', 'sched_getscheduler',
    'uname', 'sysinfo', 'getrandom', 'getrlimit', 'prlimit64', 'getrusage',
    'exit', 'exit_group', 'execve', 'execveat', 'wait4', 'waitid', 'fork', 'vfork', 'kill', 'tgkill', 'tkill',
    'pipe', 'pipe2', 'dup', 'dup2', 'dup3', 'poll', 'ppoll', 'select', 'pselect6', 'epoll_create', 'epoll_create1', 'epoll_ctl', 'epoll_wait', 'epoll_pwait', 'epoll_pwait2', 'eventfd', 'eventfd2',
    'socket', 'socketpair', 'connect', 'accept', 'accept4', 'bind', 'listen', 'shutdown', 'getsockname', 'getpeername', 'setsockopt', 'getsockopt', 'sendto', 'recvfrom', 'sendmsg', 'recvmsg', 'sendmmsg', 'recvmmsg',
    'chdir', 'fchdir', 'getcwd', 'umask', 'mkdir', 'mkdirat', 'rmdir', 'unlink', 'unlinkat', 'rename', 'renameat', 'renameat2',
    'ftruncate', 'truncate', 'fallocate', 'fsync', 'fdatasync', 'sync_file_range', 'sendfile', 'copy_file_range',
    'chmod', 'fchmod', 'fchmodat', 'utime', 'utimes', 'utimensat', 'futimesat', 'symlink', 'symlinkat', 'link', 'linkat',
    'statfs', 'fstatfs', 'getxattr', 'fgetxattr', 'lgetxattr', 'listxattr', 'flistxattr', 'llistxattr',
    'arch_prctl', 'prctl', 'ioctl', 'capget', 'setsid', 'setpgid', 'setpriority', 'sched_setaffinity',
];
export const WORKER_SECCOMP_JSON = JSON.stringify({
    defaultAction: 'SCMP_ACT_ERRNO', defaultErrnoRet: 1,
    syscalls: [
        { names: allowedSyscalls, action: 'SCMP_ACT_ALLOW' },
        { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 0x7e020000, valueTwo: 0, op: 'SCMP_CMP_MASKED_EQ' }] },
        { names: ['clone3'], action: 'SCMP_ACT_ERRNO', errnoRet: 38 },
    ],
});
export const WORKER_SECCOMP_SHA256 = createHash('sha256').update(WORKER_SECCOMP_JSON).digest('hex');
/** imageDigest is a platform Docker image/config ID; the installer resolves OCI manifests before this API. */
export function buildDockerWorkerRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('worker_request_invalid');
    const data = input;
    if (Object.keys(data).length !== 4 || Object.keys(data).some(k => !['imageDigest', 'argv', 'attemptId', 'scopeDigest'].includes(k)))
        throw Error('worker_request_extra_field');
    if (typeof data.imageDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(data.imageDigest) || typeof data.attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(data.attemptId) || typeof data.scopeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(data.scopeDigest))
        throw Error('worker_request_identity');
    if (!Array.isArray(data.argv) || !data.argv.length || data.argv.length > 256 || data.argv.some(a => typeof a !== 'string' || a.includes('\0')) || Buffer.byteLength(JSON.stringify(data.argv)) > 128 * 1024)
        throw Error('worker_request_argv');
    return {
        Image: data.imageDigest, Cmd: [...data.argv], Entrypoint: [''], User: '10000:10000',
        Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp'], WorkingDir: '/tmp',
        AttachStdin: false, AttachStdout: true, AttachStderr: true, Tty: false, OpenStdin: false,
        Healthcheck: { Test: ['NONE'] }, Labels: { 'xiaok.attempt': data.attemptId, 'xiaok.scope': data.scopeDigest, 'xiaok.seccomp': WORKER_SECCOMP_SHA256 },
        HostConfig: {
            NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: [],
            SecurityOpt: ['no-new-privileges:true', 'seccomp=' + WORKER_SECCOMP_JSON],
            PidsLimit: 64, Memory: 256 * 1024 ** 2, MemorySwap: 256 * 1024 ** 2, NanoCpus: 1_000_000_000,
            CgroupnsMode: 'private', IpcMode: 'none', PidMode: '', UTSMode: '', Binds: [], PortBindings: {},
            PublishAllPorts: false, RestartPolicy: { Name: 'no' }, AutoRemove: false,
            LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '1', 'compress': 'false' } },
            Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=33554432,mode=1777' },
            Ulimits: [{ Name: 'nofile', Soft: 256, Hard: 256 }, { Name: 'fsize', Soft: 16 * 1024 ** 2, Hard: 16 * 1024 ** 2 }, { Name: 'core', Soft: 0, Hard: 0 }],
        },
    };
}
/** Docker merges image Env/Volumes into container config, so fixed create fields alone are insufficient. */
export function assertDockerImageConfiguration(input) {
    if (!input || typeof input !== 'object')
        throw Error('worker_image_config_unknown');
    const config = input;
    if (config.Env != null && (!Array.isArray(config.Env) || config.Env.some(value => typeof value !== 'string' || !/^(PATH|HOME)=/.test(value))))
        throw Error('worker_image_inherited_env');
    if (config.Volumes !== null && config.Volumes !== undefined && (typeof config.Volumes !== 'object' || Object.keys(config.Volumes).length))
        throw Error('worker_image_inherited_volume');
    if (config.Entrypoint != null && (!Array.isArray(config.Entrypoint) || config.Entrypoint.length))
        throw Error('worker_image_entrypoint');
    if (config.OnBuild !== null && config.OnBuild !== undefined && (!Array.isArray(config.OnBuild) || config.OnBuild.length))
        throw Error('worker_image_onbuild');
}
/** Hashes the entire fixed container policy, with invocation-specific fields represented by fixed placeholders. */
export const WORKER_POLICY_SHA256 = createHash('sha256').update(JSON.stringify(buildDockerWorkerRequest({
    imageDigest: 'sha256:' + '0'.repeat(64), argv: ['/policy-placeholder'], attemptId: 'policy-placeholder', scopeDigest: '0'.repeat(64),
}))).digest('hex');
/** Private blackbox input mode: exact approved argv, no shell wrapper or new
 * environment. Invocation scope separately commits the approved case identity. */
export function buildDockerStdinWorkerRequest(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'request,stdin')
        throw Error('worker_stdin_fields');
    const { request, stdin } = input;
    if (!stdin || Object.keys(stdin).sort().join(',') !== 'bytes,sha256' || !Number.isSafeInteger(stdin.bytes) || stdin.bytes < 0 || stdin.bytes > 2 * 1024 ** 2 || !/^([a-f0-9]{64})$/.test(stdin.sha256))
        throw Error('worker_stdin_descriptor');
    const descriptor = { sha256: stdin.sha256, bytes: stdin.bytes }, body = buildDockerWorkerRequest(request);
    return { ...body, AttachStdin: true, OpenStdin: true, StdinOnce: true, Labels: { ...body.Labels, 'xiaok.stdin-sha256': descriptor.sha256, 'xiaok.stdin-bytes': String(descriptor.bytes) } };
}
