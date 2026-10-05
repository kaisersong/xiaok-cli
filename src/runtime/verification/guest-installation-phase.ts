/** Fixed service-private guest phase scripts. No project command or path input. */
export function guestInstallationLock(creationNonce:string):string{
 if(!/^[a-f0-9]{64}$/.test(creationNonce))throw Error('guest_phase_nonce');
 return `set -eu
[ "$(id -u)" = 0 ]
[ "$(cat /etc/xiaok-controller-creation-nonce)" = '${creationNonce}' ]
[ ! -L /var/lock/xiaok-engine-install.lock ]
exec 9>/var/lock/xiaok-engine-install.lock
flock -n 9
`;
}
export function guestArchiveInstall(input:{creationNonce:string;file:'docker.tgz'|'worker.tar';sha256:string}):string{
 const {creationNonce,file,sha256}=input;if(!['docker.tgz','worker.tar'].includes(file)||!/^[a-f0-9]{64}$/.test(sha256))throw Error('guest_archive_input');
 const target='/home/xiaokvm/'+file;
 return guestInstallationLock(creationNonce)+`
[ ! -L '${target}' ]
if [ -e '${target}' ]; then printf '%s  %s\\n' '${sha256}' '${target}' | sha256sum -c -; else
temp=$(mktemp /home/xiaokvm/.archive-XXXXXX)
cat > "$temp"
printf '%s  %s\\n' '${sha256}' "$temp" | sha256sum -c -
chmod 0600 "$temp"
sync -f "$temp"
mv -n "$temp" '${target}'
sync -f /home/xiaokvm
fi
`;
}
