import { parseDeploymentPackageInventory } from './deployment-package.js';
/** Renders reviewable system changes only. It does not install, launch, or grant qualification. */
export function renderMacOSDeploymentInstaller(input) {
    const inventory = parseDeploymentPackageInventory(input);
    const required = ['bin/node', 'app/controller.cjs', 'app/receiver.cjs', 'app/egress.cjs', 'app/participant.cjs', 'participant-runtime/package.json', 'participant-runtime/LICENSE', 'participant-runtime/room/store.js', 'participant-runtime/room/service.js', 'participant-runtime/room/workspace-service.js', 'participant-runtime/room/trusted-context.js', 'participant-runtime/room/constants.js', 'participant-runtime/room/reserved-namespace.js', 'app/receiver-clock-transport.cjs', 'bin/socket-peer', 'bin/process-observation', 'bin/secure-read', 'app/root-broker.cjs', 'app/deployment.cjs', 'app/controller-transport.cjs', 'bin/socket-audit-peer', 'bin/broker-user-reader', 'bin/broker-authorize', 'bin/broker-enroll-authorize', 'bin/broker-publish-authorize', 'bin/broker-archive-authorize', 'bin/broker-application-authorize', 'bin/broker-source-authorize', 'bin/broker-source-lock-custody', 'bin/broker-source-cleanup', 'bin/broker-source-sqlite-custody', 'app/source-lock-cleanup.cjs', 'bin/continuous-clock', 'bin/account-generation', 'bin/limactl', 'bin/qemu-system-aarch64', 'vm/base.qcow2'];
    if (required.some(path => !inventory.files.some(file => file.path === path)))
        throw Error('deployment_payload_missing');
    const releaseId = inventory.packageHash;
    const release = '/Library/Application Support/xiaok-verification/releases/' + releaseId;
    const state = '/Library/Application Support/xiaok-verification/state';
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.xiaok.verification</string>
<key>UserName</key><string>_xiaok_verifier</string>
<key>GroupName</key><string>_xiaok_verifier</string>
<key>ProgramArguments</key><array>
<string>/usr/bin/env</string><string>-i</string><string>PATH=/usr/bin:/bin</string>
<string>HOME=${state}</string>
<string>${release}/bin/node</string><string>${release}/app/controller.cjs</string>
</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
</dict></plist>`;
    const brokerPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.xiaok.verification.broker</string>
<key>UserName</key><string>root</string><key>GroupName</key><string>wheel</string>
<key>ProgramArguments</key><array><string>/usr/bin/env</string><string>-i</string>
<string>PATH=/usr/bin:/bin</string><string>HOME=/var/empty</string>
<string>${release}/bin/node</string><string>${release}/app/root-broker.cjs</string>
</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer></dict></plist>`;
    const receiverPlist = plist.replaceAll('dev.xiaok.verification</string>', 'dev.xiaok.verification.receiver</string>').replaceAll('_xiaok_verifier', '_xiaok_receiver').replaceAll(state, '/Library/Application Support/xiaok-verification/receiver-state').replace('/app/controller.cjs', '/app/receiver.cjs');
    const compositeKinds = ['egress', 'participant'];
    const compositeAccounts = compositeKinds.flatMap(kind => [
        `${kind}_id=400`, 'while true; do',
        `  user_matches="$(/usr/bin/dscl . -search /Users UniqueID "$${kind}_id")"`,
        `  group_matches="$(/usr/bin/dscl . -search /Groups PrimaryGroupID "$${kind}_id")"`,
        '  [ -n "$user_matches$group_matches" ] || break',
        `  ${kind}_id=$(($${kind}_id+1)); [ "$${kind}_id" -lt 500 ] || { echo composite_identity_range_exhausted >&2; exit 78; }`, 'done',
        `/usr/bin/dscl . -create /Groups/_xiaok_${kind}`,
        `/usr/bin/dscl . -create /Groups/_xiaok_${kind} PrimaryGroupID "$${kind}_id"`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind}`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} UniqueID "$${kind}_id"`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} PrimaryGroupID "$${kind}_id"`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} UserShell /usr/bin/false`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} NFSHomeDirectory "$base/${kind}-state"`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} Password "*"`,
        `/usr/bin/dscl . -create /Users/_xiaok_${kind} IsHidden 1`,
        `/usr/bin/install -d -o _xiaok_${kind} -g _xiaok_${kind} -m 0700 "$base/${kind}-state"`,
    ]);
    const compositePlists = compositeKinds.flatMap(kind => {
        const definition = plist.replaceAll('dev.xiaok.verification</string>', `dev.xiaok.verification.${kind}</string>`).replaceAll('_xiaok_verifier', '_xiaok_' + kind).replaceAll(state, `/Library/Application Support/xiaok-verification/${kind}-state`).replace('/app/controller.cjs', `/app/${kind}.cjs`);
        const path = `/Library/LaunchDaemons/dev.xiaok.verification.${kind}.plist`, delimiter = 'XIAOK_FIXED_' + kind.toUpperCase() + '_PLIST';
        return [`cat > ${path} <<'${delimiter}'`, definition, delimiter, `/usr/sbin/chown root:wheel ${path}`, `/bin/chmod 0644 ${path}`, `/usr/bin/plutil -lint ${path}`];
    });
    const ledger = inventory.files.map(file => file.sha256 + '  ' + file.path).join('\n');
    const lines = [
        '#!/bin/bash', 'set -euo pipefail', 'umask 077',
        '[ "$(/usr/bin/id -u)" = 0 ] || { echo explicit_root_installation_required >&2; exit 77; }',
        '[ "$(/usr/bin/uname -s)" = Darwin ] || { echo macos_only >&2; exit 78; }',
        '[ "$#" = 1 ] || { echo exactly_one_frozen_package_required >&2; exit 64; }',
        'source_package="$1"',
        'base="/Library/Application Support/xiaok-verification"',
        `release="${release}"`, `state="${state}"`,
        '[ ! -e "$release" ] && [ ! -L "$release" ] || { echo release_already_exists >&2; exit 73; }',
        ...['dev.xiaok.verification', 'dev.xiaok.verification.broker', 'dev.xiaok.verification.receiver', 'dev.xiaok.verification.egress', 'dev.xiaok.verification.participant'].map(label => `[ ! -e /Library/LaunchDaemons/${label}.plist ] && [ ! -L /Library/LaunchDaemons/${label}.plist ] || { echo existing_service_requires_explicit_upgrade >&2; exit 73; }`),
        ...['Users', 'Groups'].map(kind => `if /usr/bin/dscl . -read /${kind}/_xiaok_receiver >/dev/null 2>&1; then echo existing_receiver_identity_requires_explicit_recovery >&2; exit 73; fi`),
        ...compositeKinds.flatMap(kind => ['Users', 'Groups'].map(type => `if /usr/bin/dscl . -read /${type}/_xiaok_${kind} >/dev/null 2>&1; then echo existing_composite_identity_requires_recovery >&2; exit 73; fi`)),
        'if /usr/bin/dscl . -read /Users/_xiaok_verifier >/dev/null 2>&1; then echo existing_account_requires_explicit_recovery >&2; exit 73; fi',
        'if /usr/bin/dscl . -read /Groups/_xiaok_verifier >/dev/null 2>&1; then echo existing_group_requires_explicit_recovery >&2; exit 73; fi',
        '[ ! -e "$base" ] && [ ! -L "$base" ] || { echo existing_deployment_requires_explicit_recovery >&2; exit 73; }',
        '/usr/bin/install -d -o root -g wheel -m 0755 "$base" "$base/releases"',
        'stage="$(/usr/bin/mktemp -d "$base/releases/.staging.XXXXXXXX")"',
        // Keep failed staging for audit; never recursively delete potentially unrelated state on failure.
        'trap \'echo "installation_failed_staging_retained" >&2\' ERR',
        '/bin/cp -R -P "$source_package/." "$stage/"',
        '[ -z "$(/usr/bin/find "$stage" -type l -print -quit)" ] || { echo package_symlink_denied >&2; exit 65; }',
        '[ -z "$(/usr/bin/find "$stage" ! -type f ! -type d -print -quit)" ] || { echo package_special_file_denied >&2; exit 65; }',
        '[ -z "$(/usr/bin/find "$stage" -type f -links +1 -print -quit)" ] || { echo package_hardlink_denied >&2; exit 65; }',
        `[ "$(/usr/bin/find "$stage" -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')" = "${inventory.files.length}" ] || { echo package_census_changed >&2; exit 65; }`,
        'cat > "$stage/.install-ledger" <<\'XIAOK_FIXED_LEDGER\'', ledger, 'XIAOK_FIXED_LEDGER',
        '(cd "$stage" && /usr/bin/shasum -a 256 -c .install-ledger)',
        '/bin/rm -- "$stage/.install-ledger"',
        '/usr/sbin/chown -R root:wheel "$stage"',
        '/usr/bin/find "$stage" -type d -exec /bin/chmod 0755 {} +',
        '/usr/bin/find "$stage" -type f -exec /bin/chmod 0644 {} +',
        ...inventory.files.filter(file => file.executable || ['bin/node', 'bin/limactl', 'bin/qemu-system-aarch64'].includes(file.path)).map(file => `/bin/chmod 0755 "$stage/${file.path}"`),
        // Trusted frozen code must inspect the complete dynamic dependency closure before any account or service starts.
        'cat > "$release.json" <<\'XIAOK_FIXED_INVENTORY\'', JSON.stringify(inventory), 'XIAOK_FIXED_INVENTORY',
        '/bin/chmod 0644 "$release.json"',
        '/usr/bin/env -i PATH=/usr/bin:/bin "$stage/bin/node" "$stage/app/deployment.cjs" deployment-preflight --release-root "$stage" --target-root "$release" --inventory "$release.json"',
        '/bin/mv "$stage" "$release"',
        'service_id=400',
        'while true; do',
        '  user_matches="$(/usr/bin/dscl . -search /Users UniqueID "$service_id")"',
        '  group_matches="$(/usr/bin/dscl . -search /Groups PrimaryGroupID "$service_id")"',
        '  [ -n "$user_matches$group_matches" ] || break',
        '  service_id=$((service_id+1)); [ "$service_id" -lt 500 ] || { echo service_identity_range_exhausted >&2; exit 78; }',
        'done',
        '/usr/bin/dscl . -create /Groups/_xiaok_verifier',
        '/usr/bin/dscl . -create /Groups/_xiaok_verifier PrimaryGroupID "$service_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier UniqueID "$service_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier PrimaryGroupID "$service_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier UserShell /usr/bin/false',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier NFSHomeDirectory "$state"',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier Password "*"',
        '/usr/bin/dscl . -create /Users/_xiaok_verifier IsHidden 1',
        '/usr/bin/install -d -o _xiaok_verifier -g _xiaok_verifier -m 0700 "$state"',
        'receiver_id=400',
        'while true; do',
        '  user_matches="$(/usr/bin/dscl . -search /Users UniqueID "$receiver_id")"',
        '  group_matches="$(/usr/bin/dscl . -search /Groups PrimaryGroupID "$receiver_id")"',
        '  [ -n "$user_matches$group_matches" ] || break',
        '  receiver_id=$((receiver_id+1)); [ "$receiver_id" -lt 500 ] || { echo receiver_identity_range_exhausted >&2; exit 78; }',
        'done',
        '[ "$receiver_id" != "$service_id" ] || { echo receiver_identity_conflict >&2; exit 78; }',
        '/usr/bin/dscl . -create /Groups/_xiaok_receiver',
        '/usr/bin/dscl . -create /Groups/_xiaok_receiver PrimaryGroupID "$receiver_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver UniqueID "$receiver_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver PrimaryGroupID "$receiver_id"',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver UserShell /usr/bin/false',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver NFSHomeDirectory "$base/receiver-state"',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver Password "*"',
        '/usr/bin/dscl . -create /Users/_xiaok_receiver IsHidden 1',
        '/usr/bin/install -d -o _xiaok_receiver -g _xiaok_receiver -m 0700 "$base/receiver-state"',
        `/usr/bin/env -i PATH=/usr/bin:/bin "$release/bin/node" "$release/app/deployment.cjs" initialize-state '${releaseId}' "$service_id" "$receiver_id"`,
        '/usr/bin/install -d -o root -g wheel -m 0700 "$base/provisioning"',
        ...compositeAccounts,
        `/usr/bin/env -i PATH=/usr/bin:/bin "$release/bin/node" "$release/app/deployment.cjs" initialize-composite-state '${releaseId}' "$egress_id" "$participant_id"`,
        ...compositePlists,
        'cat > /Library/LaunchDaemons/dev.xiaok.verification.broker.plist <<\'XIAOK_FIXED_BROKER_PLIST\'', brokerPlist, 'XIAOK_FIXED_BROKER_PLIST',
        '/usr/sbin/chown root:wheel /Library/LaunchDaemons/dev.xiaok.verification.broker.plist',
        '/bin/chmod 0644 /Library/LaunchDaemons/dev.xiaok.verification.broker.plist',
        '/usr/bin/plutil -lint /Library/LaunchDaemons/dev.xiaok.verification.broker.plist',
        'cat > /Library/LaunchDaemons/dev.xiaok.verification.plist <<\'XIAOK_FIXED_PLIST\'', plist, 'XIAOK_FIXED_PLIST',
        '/usr/sbin/chown root:wheel /Library/LaunchDaemons/dev.xiaok.verification.plist',
        '/bin/chmod 0644 /Library/LaunchDaemons/dev.xiaok.verification.plist',
        '/usr/bin/plutil -lint /Library/LaunchDaemons/dev.xiaok.verification.plist',
        'cat > /Library/LaunchDaemons/dev.xiaok.verification.receiver.plist <<\'XIAOK_FIXED_RECEIVER_PLIST\'', receiverPlist, 'XIAOK_FIXED_RECEIVER_PLIST',
        '/usr/sbin/chown root:wheel /Library/LaunchDaemons/dev.xiaok.verification.receiver.plist',
        '/bin/chmod 0644 /Library/LaunchDaemons/dev.xiaok.verification.receiver.plist',
        '/usr/bin/plutil -lint /Library/LaunchDaemons/dev.xiaok.verification.receiver.plist',
        // A new nonshared SecurityAgent authentication is required for each exact review.
        // Never overwrite an independently installed right during initial deployment.
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.materials >/dev/null 2>&1; then echo existing_authorization_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.materials <<\'XIAOK_FIXED_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_AUTHORIZATION',
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.enrollment >/dev/null 2>&1; then echo existing_enrollment_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.enrollment <<\'XIAOK_FIXED_ENROLLMENT_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_ENROLLMENT_AUTHORIZATION',
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.publication >/dev/null 2>&1; then echo existing_publication_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.publication <<\'XIAOK_FIXED_PUBLICATION_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_PUBLICATION_AUTHORIZATION',
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.archive >/dev/null 2>&1; then echo existing_archive_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.archive <<\'XIAOK_FIXED_ARCHIVE_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_ARCHIVE_AUTHORIZATION',
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.application >/dev/null 2>&1; then echo existing_application_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.application <<\'XIAOK_FIXED_APPLICATION_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_APPLICATION_AUTHORIZATION',
        'if /usr/bin/security authorizationdb read dev.xiaok.verification.profile-sources >/dev/null 2>&1; then echo existing_profile_sources_right_requires_review >&2; exit 73; fi',
        '/usr/bin/security authorizationdb write dev.xiaok.verification.profile-sources <<\'XIAOK_FIXED_PROFILE_SOURCES_AUTHORIZATION\'',
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>class</key><string>user</string><key>group</key><string>admin</string><key>authenticate-user</key><true/><key>shared</key><false/><key>allow-root</key><false/><key>timeout</key><integer>0</integer></dict></plist>',
        'XIAOK_FIXED_PROFILE_SOURCES_AUTHORIZATION',
        '/bin/launchctl bootstrap system /Library/LaunchDaemons/dev.xiaok.verification.broker.plist',
        '/bin/launchctl bootstrap system /Library/LaunchDaemons/dev.xiaok.verification.receiver.plist',
        ...compositeKinds.map(kind => `/bin/launchctl bootstrap system /Library/LaunchDaemons/dev.xiaok.verification.${kind}.plist`),
        '/bin/launchctl bootstrap system /Library/LaunchDaemons/dev.xiaok.verification.plist',
        'echo "installed_not_yet_qualified: run independent identity/engine/clock/escape qualification"',
    ];
    return Object.freeze({ releaseId, installScript: lines.join('\n') + '\n' });
}
