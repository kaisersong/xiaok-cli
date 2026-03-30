export type YZJRemoteCommand =
  | { kind: 'help' }
  | { kind: 'status'; taskId?: string }
  | { kind: 'cancel'; taskId: string }
  | { kind: 'skill'; skillName: string; args?: string }
  | { kind: 'plain'; text: string };

export function parseYZJCommand(input: string): YZJRemoteCommand {
  const text = input.trim();
  if (!text.startsWith('/')) {
    return { kind: 'plain', text };
  }

  const withoutSlash = text.slice(1).trim();
  if (!withoutSlash) return { kind: 'help' };

  const [command, ...restParts] = withoutSlash.split(/\s+/);
  const rest = restParts.join(' ').trim();

  switch ((command ?? '').toLowerCase()) {
    case 'help':
      return { kind: 'help' };
    case 'status':
      return { kind: 'status', taskId: rest || undefined };
    case 'cancel':
      return rest ? { kind: 'cancel', taskId: rest } : { kind: 'help' };
    case 'skill': {
      const [skillName, ...args] = rest.split(/\s+/).filter(Boolean);
      if (!skillName) return { kind: 'help' };
      return { kind: 'skill', skillName, args: args.join(' ') || undefined };
    }
    default:
      return { kind: 'plain', text };
  }
}
