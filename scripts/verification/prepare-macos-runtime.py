#!/usr/bin/env python3
"""Assemble pinned local archives only; never install, sign, or launch a service.

Python >=3.12; archive-dir contains <sha256>.archive files from the reviewed lock.
The resulting runtime is an input to the whole controller package, not authority.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import tarfile
import tempfile
import subprocess
import platform


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def copy_file(source, target):
    if not source.is_file():
        raise ValueError('runtime source is not a regular file')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if digest(source) != digest(target):
            raise ValueError('conflicting runtime basename: ' + target.name)
        return
    shutil.copy2(source, target)


def extract(archive, target):
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 8 * 1024**3:
            raise ValueError('archive census limit')
        # Python data_filter rejects outside links, special devices and traversal.
        bundle.extractall(target, members=members, filter='data')


def validate_worker_archive(path, image_id):
    """Bind the offline Docker load archive to its exact reviewed config/layers.
    This checks package inputs, not whether the resulting engine is qualified.
    """
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('worker image identity')
    with tarfile.open(path) as bundle:
        members = bundle.getmembers()
        if len(members) > 4096 or sum(m.size for m in members) > 128 * 1024**2:
            raise ValueError('worker archive budget')
        names = {}
        for member in members:
            if member.name in names:
                raise ValueError('worker archive duplicate')
            if not (member.isfile() or member.isdir()) or any(p in ('', '.', '..') for p in member.name.rstrip('/').split('/')):
                raise ValueError('worker archive entry')
            names[member.name] = member
        def read(name, limit):
            member = names.get(name)
            if not member or not member.isfile() or member.size > limit:
                raise ValueError('worker archive content')
            return bundle.extractfile(member).read()
        manifests = json.loads(read('manifest.json', 65536))
        if not isinstance(manifests, list) or len(manifests) != 1:
            raise ValueError('worker image identity')
        manifest = manifests[0]
        config_name = 'blobs/sha256/' + image_id[7:]
        if manifest.get('Config') != config_name:
            raise ValueError('worker image identity')
        config_bytes = read(config_name, 1024**2)
        if hashlib.sha256(config_bytes).hexdigest() != image_id[7:]:
            raise ValueError('worker image identity')
        config = json.loads(config_bytes)
        if config.get('os') != 'linux' or config.get('architecture') != 'arm64':
            raise ValueError('worker image platform')
        layers = manifest.get('Layers')
        if not isinstance(layers, list) or not layers or len(layers) > 128 or len(set(layers)) != len(layers):
            raise ValueError('worker image layers')
        for name in layers:
            if not isinstance(name, str) or not re.fullmatch(r'blobs/sha256/[a-f0-9]{64}', name):
                raise ValueError('worker image layers')
            body = read(name, 128 * 1024**2)
            if hashlib.sha256(body).hexdigest() != name.rsplit('/', 1)[1]:
                raise ValueError('worker image layer hash')


def prepare(archive_dir, output, lock_path):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('this frozen payload targets macOS arm64')
    lock = json.loads(lock_path.read_text())
    if output.exists():
        raise ValueError('output must be a new directory; no implicit overwrite')
    packages = lock['packages']
    entries = packages + [lock['lima'], lock['baseImage'], lock['engine'], lock['workerImage']]
    archives = {}
    # Validate all source bytes before writing output, never trust a cache filename.
    for entry in entries:
        key = entry['sha256']
        if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
            raise ValueError('invalid source hash')
        source = archive_dir / (key + '.archive')
        if source.is_symlink() or not source.is_file() or digest(source) != key:
            raise ValueError('missing or changed pinned archive: ' + key)
        archives[key] = source
    validate_worker_archive(archives[lock['workerImage']['sha256']], lock['workerImage']['imageId'])
    output.mkdir(parents=True)
    licenses = []
    with tempfile.TemporaryDirectory(prefix='xiaok-runtime-build-') as temporary:
        temporary = pathlib.Path(temporary)
        for index, package in enumerate(packages):
            extracted = temporary / str(index)
            extract(archives[package['sha256']], extracted)
            for library in extracted.rglob('*.dylib'):
                resolved = library.resolve(strict=True)
                if not resolved.is_relative_to(extracted.resolve()):
                    raise ValueError('outside runtime library')
                copy_file(resolved, output / 'lib' / library.name)
            if package['name'] == 'qemu':
                roots = list(extracted.glob('qemu/*/bin/qemu-system-aarch64'))
                if len(roots) != 1:
                    raise ValueError('ambiguous qemu package')
                prefix = roots[0].parent.parent
                for name in ['qemu-system-aarch64', 'qemu-img']:
                    copy_file(prefix / 'bin' / name, output / 'bin' / name)
                for name in ['edk2-aarch64-code.fd', 'edk2-arm-vars.fd']:
                    copy_file(prefix / 'share' / 'qemu' / name, output / 'share' / 'qemu' / name)
            # Preserve license/provenance inputs without executing bottle hooks.
            for license_file in extracted.rglob('LICENSE*'):
                if license_file.is_file():
                    rel = license_file.relative_to(extracted)
                    portable = pathlib.Path(*[re.sub(r'[^A-Za-z0-9_.+-]', '_', part) for part in rel.parts])
                    target = output / 'licenses' / str(index) / portable
                    copy_file(license_file, target)
                    licenses.append({'package': package['name'], 'originalPath': str(rel), 'path': str(target.relative_to(output)), 'sha256': digest(target)})
        lima = temporary / 'lima'
        extract(archives[lock['lima']['sha256']], lima)
        copy_file(lima / 'bin' / 'limactl', output / 'bin' / 'limactl')
        copy_file(lima / 'share' / 'lima' / 'lima-guestagent.Linux-aarch64.gz', output / 'share' / 'lima' / 'lima-guestagent.Linux-aarch64.gz')
        copy_file(lima / 'share' / 'doc' / 'lima' / 'LICENSE', output / 'licenses' / 'lima' / 'LICENSE')
    copy_file(archives[lock['baseImage']['sha256']], output / 'vm' / 'base.qcow2')
    copy_file(archives[lock['engine']['sha256']], output / 'vm' / 'docker.tgz')
    with tarfile.open(archives[lock['engine']['sha256']]) as engine_archive:
        binaries = []
        for name in ['containerd', 'containerd-shim-runc-v2', 'ctr', 'docker', 'docker-init', 'docker-proxy', 'dockerd', 'runc']:
            member = engine_archive.getmember('docker/' + name)
            if not member.isfile() or member.size < 1 or member.size > 256 * 1024**2:
                raise ValueError('engine binary archive')
            body = engine_archive.extractfile(member).read()
            binaries.append({'name': name, 'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body)})
        (output / 'vm' / 'engine-files.json').write_text(json.dumps(binaries, indent=2) + '\n')

    copy_file(archives[lock['workerImage']['sha256']], output / 'vm' / 'worker.tar')
    sqlite_source = pathlib.Path(__file__).resolve().parents[2] / 'node_modules/better-sqlite3/deps/sqlite3'
    for filename, expected in [('sqlite3.c', '6a2805f8c1ef020a7086e62258519323cf98b219e9fe87a42065d916cfebaefc'), ('sqlite3.h', '919e7f2e8ed1d8f56ac17b412b8971c76aa5d1a879752cc6058f75e7d5910e1d')]:
        if digest(sqlite_source / filename) != expected:
            raise ValueError('source custody SQLite implementation requires review')
        copy_file(sqlite_source / filename, output / 'native/sqlite' / filename)
    sqlite_object = output / 'native/sqlite/source-custody.o'
    sqlite_flags = ['-O2', '-DSQLITE_THREADSAFE=0', '-DSQLITE_OMIT_LOAD_EXTENSION=1', '-DSQLITE_TEMP_STORE=3', '-DSQLITE_ENABLE_DBPAGE_VTAB=1']
    helper_flags = ['-O2', '-Wall', '-Wextra', '-Werror']
    flags_bytes = json.dumps({'amalgamation': sqlite_flags, 'helper': helper_flags}, sort_keys=True, separators=(',', ':')).encode()
    sqlite_provenance = {'version': 1, 'sqliteVersion': '3.53.4', 'sourceSha256': digest(sqlite_source / 'sqlite3.c'), 'headerSha256': digest(sqlite_source / 'sqlite3.h'), 'compileFlags': json.loads(flags_bytes), 'compileFlagsSha256': hashlib.sha256(flags_bytes).hexdigest()}
    (output / 'native/sqlite/provenance.json').write_text(json.dumps(sqlite_provenance, sort_keys=True, indent=2) + '\n')
    copy_file(sqlite_source.parents[1] / 'LICENSE', output / 'licenses/source-custody/better-sqlite3-LICENSE')
    # The complete copied amalgamation retains SQLite's own public-domain notice.
    subprocess.run(['/usr/bin/cc', *sqlite_flags, '-c', str(sqlite_source / 'sqlite3.c'), '-o', str(sqlite_object)], check=True)
    for helper in ['process-observation', 'secure-read', 'socket-peer', 'socket-audit-peer', 'broker-user-reader', 'broker-authorize', 'broker-enroll-authorize', 'broker-publish-authorize', 'broker-archive-authorize', 'broker-application-authorize', 'broker-source-authorize', 'broker-source-lock-custody', 'broker-source-cleanup', 'broker-source-sqlite-custody', 'continuous-clock', 'account-generation']:
        extension = '.m' if helper == 'account-generation' else '.c'
        source = pathlib.Path(__file__).resolve().parents[2] / ('src/runtime/verification/native/' + helper + extension)
        copy_file(source, output / 'native' / (helper + extension))
        libraries = ['-fobjc-arc', '-framework', 'Foundation', '-framework', 'OpenDirectory'] if helper == 'account-generation' else ['-lbsm'] if helper == 'socket-audit-peer' else ['-fobjc-arc', str(source.with_name('review-panel.m')), '-framework', 'AppKit', '-framework', 'Foundation', '-framework', 'Security', '-framework', 'CoreFoundation', '-lbsm'] if helper in ['broker-authorize', 'broker-enroll-authorize', 'broker-publish-authorize', 'broker-archive-authorize', 'broker-application-authorize', 'broker-source-authorize'] else []
        if helper == 'broker-source-sqlite-custody':
            libraries = ['-I', str(sqlite_source), str(sqlite_object)]
        subprocess.run(['/usr/bin/cc', '-O2', '-Wall', '-Wextra', '-Werror', str(source), *libraries, '-o', str(output / 'bin' / helper)], check=True)
    for panel_source in ['review-panel.h', 'review-panel.m', 'source-lock-custody.c', 'source-sqlite-custody.c', 'source-custody-channel.h', 'source-directory-capture.h', 'source-session-locks.h']:
        copy_file(source.with_name(panel_source), output / 'native' / panel_source)
    (output / 'empty').mkdir()
    (output / 'lib' / 'qemu').mkdir(exist_ok=True)
    copy_file(lock_path, output / 'runtime-sources.json')
    (output / 'licenses-index.json').write_text(json.dumps(licenses, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'pinnedArchives': len(entries), 'installed': False, 'qualified': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(args.archive_dir.resolve(), args.output.resolve(), pathlib.Path(__file__).with_name('macos-runtime-sources.json'))
