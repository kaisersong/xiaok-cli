export interface RoomAgentNameSource { id: string; name?: string; alias?: string }

/** Stable readable handles shared by the UI projection and main-owned routing. */
export function roomAgentNames(agents: RoomAgentNameSource[]): Map<string, string> {
  const sorted = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const used = new Set(['all', ...sorted.map(agent => agent.id.toLowerCase())]);
  const result = new Map<string, string>();
  for (const [index, agent] of sorted.entries()) {
    const base = (agent.alias || agent.name || `Agent ${index + 1}`).replace(/[@\p{Cc}\p{Cf}]/gu, '').trim() || `Agent ${index + 1}`;
    let label = base;
    let suffix = 2;
    while (used.has(label.toLowerCase())) label = `${base} (${suffix++})`;
    used.add(label.toLowerCase()); result.set(agent.id, label);
  }
  return result;
}
