import { join } from 'node:path';
/** Fixed deployment plan, not an engine qualification. The installed caller must
 * verify the full package and service identity before executing any command. */
export function buildPrivateMacEnginePlan(input) {
    const { releaseRoot, stateRoot, baseImageSha256, dockerArchiveSha256, creationNonce } = input;
    const base = '/Library/Application Support/xiaok-verification';
    if (!new RegExp('^' + base + '/releases/[a-f0-9]{64}$').test(releaseRoot) || stateRoot !== join(base, 'state') || ![baseImageSha256, dockerArchiveSha256, creationNonce].every(x => /^[a-f0-9]{64}$/.test(x)))
        throw Error('engine_bootstrap_paths');
    const name = 'xiaok-engine', hostSocket = join(stateRoot, 'engine.sock'), configPath = join(stateRoot, 'engine-config.json');
    const config = { minimumLimaVersion: '2.2.0', vmType: 'qemu', arch: 'aarch64', images: [{ location: join(releaseRoot, 'vm/base.qcow2'), arch: 'aarch64', digest: 'sha256:' + baseImageSha256 }], cpus: 2, memory: '2GiB', disk: '8GiB', mounts: [], additionalDisks: [], mountInotify: false,
        user: { name: 'xiaokvm', comment: 'Xiaok verification service', uid: 1000, home: '/home/xiaokvm', shell: '/bin/bash', passwordlessSudo: true },
        ssh: { loadDotSSHPubKeys: false, forwardAgent: false, forwardX11: false, forwardX11Trusted: false, overVsock: false },
        containerd: { system: false, user: false }, upgradePackages: false, propagateProxyEnv: false, timezone: 'UTC', hostResolver: { enabled: false }, copyToHost: [],
        // Disable Lima's implicit fallback forwarding after the sole management socket.
        portForwards: [{ guestSocket: '/run/xiaok-engine/docker.sock', hostSocket }, { guestIP: '0.0.0.0', guestIPMustBeZero: false, proto: 'any', guestPortRange: [1, 65535], ignore: true }],
        param: { controllerCreationNonce: creationNonce },
        provision: [{ mode: 'data', path: '/etc/xiaok-controller-creation-nonce', content: '{{.Param.controllerCreationNonce}}\n', owner: 'root:root', permissions: '0444', overwrite: false }, { mode: 'dependency', skipDefaultDependencyResolution: true, script: '#!/bin/sh\nset -eu\ncommand -v tar\ncommand -v sha256sum\ncommand -v systemctl\n' }],
    };
    const unit = `[Unit]
Description=Xiaok isolated verification engine
After=network.target
[Service]
Type=simple
Group=xiaokvm
Environment=PATH=/usr/local/lib/xiaok-engine:/usr/sbin:/usr/bin:/sbin:/bin
RuntimeDirectory=xiaok-engine
RuntimeDirectoryMode=0750
ExecStart=/usr/local/lib/xiaok-engine/dockerd --host=unix:///run/xiaok-engine/docker.sock --group=xiaokvm --data-root=/var/lib/xiaok-engine --exec-root=/run/xiaok-engine/runtime --pidfile=/run/xiaok-engine/docker.pid --bridge=none --iptables=false --ip6tables=false --ip-forward=false --userland-proxy=false
Delegate=yes
KillMode=process
Restart=no
[Install]
WantedBy=multi-user.target
`;
    const bootstrapScript = `#!/bin/sh
set -eu
[ "$(id -u)" = 0 ]
[ "$(cat /etc/xiaok-controller-creation-nonce)" = '${creationNonce}' ]
printf '%s  %s\\n' '${dockerArchiveSha256}' '/home/xiaokvm/docker.tgz' | sha256sum -c -
# The only accepted members belong to the already hash-verified fixed archive.
[ "$(tar -tzf /home/xiaokvm/docker.tgz | LC_ALL=C sort)" = "$(printf '%s\\n' docker/ docker/containerd docker/containerd-shim-runc-v2 docker/ctr docker/docker docker/docker-init docker/docker-proxy docker/dockerd docker/runc | LC_ALL=C sort)" ]
[ ! -L /usr/local/lib/xiaok-engine ]
install -d -m 0755 /usr/local/lib/xiaok-engine
# Existing installed bytes are immutable: a retry may add missing files, never
# replace different content. Each new file appears only after full hash+sync.
for name in containerd containerd-shim-runc-v2 ctr docker docker-init docker-proxy dockerd runc; do
 target=/usr/local/lib/xiaok-engine/$name
 expected=$(tar -xOzf /home/xiaokvm/docker.tgz docker/$name | sha256sum | cut -d ' ' -f 1)
 if [ -e "$target" ] || [ -L "$target" ]; then
  [ ! -L "$target" ] && [ -f "$target" ] && [ "$(stat -c %h "$target")" = 1 ]
  printf '%s  %s\\n' "$expected" "$target" | sha256sum -c -
 else
  temp=$(mktemp /usr/local/lib/xiaok-engine/.install-XXXXXX)
  tar -xOzf /home/xiaokvm/docker.tgz docker/$name > "$temp"
  printf '%s  %s\\n' "$expected" "$temp" | sha256sum -c -
  chmod 0755 "$temp"
  sync -f "$temp"
  mv -n "$temp" "$target"
  printf '%s  %s\\n' "$expected" "$target" | sha256sum -c -
  sync -f /usr/local/lib/xiaok-engine
 fi
done
unit=$(mktemp /etc/systemd/system/.xiaok-engine-XXXXXX)
cat > "$unit" <<'UNIT'
${unit}UNIT
chmod 0644 "$unit"
sync -f "$unit"
if [ -e /etc/systemd/system/xiaok-engine.service ] || [ -L /etc/systemd/system/xiaok-engine.service ]; then
 [ ! -L /etc/systemd/system/xiaok-engine.service ] && [ -f /etc/systemd/system/xiaok-engine.service ]
 cmp -s "$unit" /etc/systemd/system/xiaok-engine.service
 rm "$unit"
else
 mv -n "$unit" /etc/systemd/system/xiaok-engine.service
 sync -f /etc/systemd/system
fi
systemctl daemon-reload
systemctl enable xiaok-engine.service
# systemd start is idempotent for the same existing active unit. Never restart
# a running engine or change its arguments during recovery.
systemctl start xiaok-engine.service
systemctl is-active --quiet xiaok-engine.service
`;
    const env = Object.freeze({ PATH: join(releaseRoot, 'bin') + ':/usr/bin:/bin', HOME: stateRoot, LIMA_HOME: join(stateRoot, 'lima'), LC_ALL: 'C', DYLD_LIBRARY_PATH: join(releaseRoot, 'lib'), DYLD_FALLBACK_LIBRARY_PATH: '/var/empty', QEMU_MODULE_DIR: join(releaseRoot, 'lib/qemu'), GIO_MODULE_DIR: join(releaseRoot, 'empty'), GIO_EXTRA_MODULES: join(releaseRoot, 'empty') });
    return Object.freeze({ name, hostSocket, configPath, unit, configJson: JSON.stringify(config, null, 2) + '\n', bootstrapScript, executable: join(releaseRoot, 'bin/limactl'), env,
        validateArgv: Object.freeze(['validate', configPath]), startArgv: Object.freeze(['start', '--tty=false', '--name=' + name, configPath]),
        copyEngineArgv: Object.freeze(['copy', join(releaseRoot, 'vm/docker.tgz'), name + ':/home/xiaokvm/docker.tgz']),
        bootstrapArgv: Object.freeze(['shell', name, 'sudo', '-n', '/bin/sh', '-s']),
    });
}
