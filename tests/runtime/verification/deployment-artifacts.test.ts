import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { snapshotDeploymentPackage, verifyDeploymentPackage } from '../../../src/runtime/verification/deployment-package.js';
import { renderMacOSDeploymentInstaller } from '../../../src/runtime/verification/deployment-artifacts.js';

describe('reviewable macOS installer artifact, never implicit installation', () => {
  it('requires a complete runtime/VM payload and emits a syntactically valid guarded installer', () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-installer-'));
    try {
      writeFileSync(join(root, 'partial'), 'x');
      expect(() => renderMacOSDeploymentInstaller(snapshotDeploymentPackage(root))).toThrow('deployment_payload_missing');
      for (const name of ['bin/node', 'app/controller.cjs', 'app/receiver.cjs', 'app/egress.cjs', 'app/participant.cjs', 'participant-runtime/package.json', 'participant-runtime/LICENSE', 'participant-runtime/room/store.js', 'participant-runtime/room/service.js', 'participant-runtime/room/workspace-service.js', 'participant-runtime/room/trusted-context.js', 'participant-runtime/room/constants.js', 'participant-runtime/room/reserved-namespace.js', 'app/receiver-clock-transport.cjs', 'bin/socket-peer', 'bin/process-observation', 'bin/secure-read', 'app/root-broker.cjs', 'app/deployment.cjs', 'app/controller-transport.cjs', 'bin/socket-audit-peer', 'bin/broker-user-reader', 'bin/broker-authorize', 'bin/broker-enroll-authorize', 'bin/broker-publish-authorize', 'bin/broker-archive-authorize', 'bin/broker-application-authorize', 'bin/broker-source-authorize', 'bin/broker-source-lock-custody', 'bin/broker-source-cleanup', 'bin/broker-source-sqlite-custody', 'app/source-lock-cleanup.cjs', 'bin/continuous-clock', 'bin/account-generation', 'bin/limactl', 'bin/qemu-system-aarch64', 'vm/base.qcow2']) {
        const path = join(root, ...name.split('/')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture bytes: not a real installable runtime');
      }
      const artifact = renderMacOSDeploymentInstaller(snapshotDeploymentPackage(root));
      const path = join(root, 'install.sh'); writeFileSync(path, artifact.installScript);
      if (process.platform !== 'win32') {
        expect(spawnSync('/bin/bash', ['-n', path], { encoding: 'utf8' }).status).toBe(0);
        if (process.getuid?.() !== 0) {
          const attempted = spawnSync('/bin/bash', [path, root], { encoding: 'utf8' });
          expect(attempted.status).not.toBe(0);
          expect(attempted.stderr).toContain('explicit_root_installation_required');
        }
      }
      const arrays=[...artifact.installScript.matchAll(/<key>ProgramArguments<\/key><array>([\s\S]*?)<\/array>/g)].map(match=>[...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map(item=>item[1]));
      expect(arrays).toHaveLength(5);
      if(process.platform==='darwin')for(const match of artifact.installScript.matchAll(/<\?xml[\s\S]*?<\/plist>/g)){const lint=spawnSync('/usr/bin/plutil',['-lint','-'],{input:match[0],encoding:'utf8'});expect(lint.status,lint.stderr).toBe(0);}
      for(const name of ['controller','receiver','root-broker','egress','participant']){const args=arrays.find(args=>args.some(arg=>arg.endsWith('/app/'+name+'.cjs')))!;expect(args).toBeDefined();expect(args.at(-1)).toMatch(new RegExp('/app/'+name+'\\.cjs$'));}
      expect(artifact.installScript).toContain('"$service_id" "$receiver_id"');
      expect(artifact.installScript).toContain('/Users/_xiaok_receiver');
      expect(artifact.installScript).toContain('receiver-state');
      for(const kind of ['egress','participant']){expect(artifact.installScript).toContain('/Users/_xiaok_'+kind);expect(artifact.installScript).toContain(kind+'-state');expect(artifact.installScript).toContain('dev.xiaok.verification.'+kind+'.plist');}
      expect(artifact.installScript).toContain('initialize-composite-state');
      expect(artifact.installScript).toContain('dev.xiaok.verification.receiver.plist');
      expect(artifact.installScript).toContain('dev.xiaok.verification.broker.plist');
      expect(artifact.installScript).toContain('initialize-state');
      expect(artifact.installScript).toContain('/usr/bin/security authorizationdb write dev.xiaok.verification.materials');
      expect(artifact.installScript).toContain('/usr/bin/security authorizationdb write dev.xiaok.verification.enrollment');
      expect(artifact.installScript).toContain('/usr/bin/security authorizationdb write dev.xiaok.verification.publication');
      expect(artifact.installScript).toContain('/usr/bin/security authorizationdb write dev.xiaok.verification.profile-sources');
      expect(artifact.installScript).toContain('existing_profile_sources_right_requires_review');
      expect(artifact.installScript).toContain('<key>allow-root</key><false/>');
      expect(artifact.installScript).toContain('--inventory');
      expect(artifact.releaseId).toMatch(/^[a-f0-9]{64}$/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform !== 'darwin')('executes actual staging and leaves precisely the frozen payload before preflight', () => {
    const root = mkdtempSync(join(tmpdir(), 'installer-stage-'));
    try {
      const source = join(root, 'source'), stage = join(root, 'stage');
      mkdirSync(stage); mkdirSync(source);
      for (const name of ['bin/node', 'app/controller.cjs', 'app/receiver.cjs', 'app/egress.cjs', 'app/participant.cjs', 'participant-runtime/package.json', 'participant-runtime/LICENSE', 'participant-runtime/room/store.js', 'participant-runtime/room/service.js', 'participant-runtime/room/workspace-service.js', 'participant-runtime/room/trusted-context.js', 'participant-runtime/room/constants.js', 'participant-runtime/room/reserved-namespace.js', 'app/receiver-clock-transport.cjs', 'bin/socket-peer', 'bin/process-observation', 'bin/secure-read', 'app/root-broker.cjs', 'app/deployment.cjs', 'app/controller-transport.cjs', 'bin/socket-audit-peer', 'bin/broker-user-reader', 'bin/broker-authorize', 'bin/broker-enroll-authorize', 'bin/broker-publish-authorize', 'bin/broker-archive-authorize', 'bin/broker-application-authorize', 'bin/broker-source-authorize', 'bin/broker-source-lock-custody', 'bin/broker-source-cleanup', 'bin/broker-source-sqlite-custody', 'app/source-lock-cleanup.cjs', 'bin/continuous-clock', 'bin/account-generation', 'bin/limactl', 'bin/qemu-system-aarch64', 'vm/base.qcow2']) {
        const file = join(source, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'payload');
      }
      const inventory = snapshotDeploymentPackage(source);
      const script = renderMacOSDeploymentInstaller(inventory).installScript;
      // Execute the rendered filesystem/checksum block unchanged; omit only privileged account/ownership operations.
      const block = script.slice(script.indexOf('/bin/cp -R -P'), script.indexOf('/usr/sbin/chown -R'));
      const result = spawnSync('/bin/bash', ['-euc', 'source_package="$1"; stage="$2"; ' + block, '--', source, stage], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(() => verifyDeploymentPackage(stage, inventory)).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
