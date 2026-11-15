/** Read deployment targets from otool -l, including every universal slice. */
export function assertMacOS12Deployment(output) {
  const header = /^[^\n]*\(architecture [^)]+\):\s*$/m;
  const slices = header.test(output) ? output.split(new RegExp(header.source, 'm')).slice(1) : [output];
  return slices.map(slice => {
    const commands = [...slice.matchAll(/\bcmd (LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX)\n([\s\S]*?)(?=\nLoad command|$)/g)];
    if (commands.length !== 1) throw Error('missing_or_ambiguous_deployment_target');
    const key = commands[0][1] === 'LC_BUILD_VERSION' ? 'minos' : 'version';
    const version = new RegExp('\\b' + key + '\\s+(\\d+\\.\\d+(?:\\.\\d+)?)(?:\\s|$)').exec(commands[0][2])?.[1];
    if (!version) throw Error('invalid_deployment_target');
    const [major, minor, patch = 0] = version.split('.').map(Number);
    if (major > 12 || major === 12 && (minor > 0 || patch > 0)) throw Error('macOS12_unsupported:' + version);
    return version;
  });
}
