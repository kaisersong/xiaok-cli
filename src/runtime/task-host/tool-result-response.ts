/** UI/delivery projection only. Model and durable operation results stay complete. */
export function formatTaskToolResultResponse(toolName: string, value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (toolName === 'create_project') {
    const card = compactProjectCreationResponse(raw);
    if (card) return card;
  }
  return raw.slice(0, 10000);
}

export function compactProjectCreationResponse(raw: string): string | undefined {
  let data: Record<string, unknown>;
  try { data = record(JSON.parse(raw)); } catch { return undefined; }
  const legacy = data.type === 'project_card';
  if (data.ok === false || 'error' in data || !legacy && (data.ok !== true || data.created !== true)) return undefined;
  const project = legacy ? data : record(data.project);
  const id = text(legacy ? data.projectId : project.id, 256);
  const name = text(project.name, 200);
  if (/[\u0000-\u001f]/.test(id)) return undefined;
  if (!id || !name || !legacy && typeof data.projectId === 'string' && data.projectId.trim() !== id) return undefined;
  // Reject identity truncation rather than manufacture a different project route.
  if (String(legacy ? data.projectId : project.id).trim().length > 256) return undefined;
  const status = text(project.status, 80) || 'created';
  const goal = text(project.goal, 700);
  const created = typeof project.createdAt === 'number' ? project.createdAt : Date.parse(String(project.createdAt));
  const memberCount = Array.isArray(project.members) ? project.members.length : Number(project.memberCount) || 0;
  const planning = record(data.planningStart);
  const card = { ok: true, created: true, type: 'project_card', projectId: id, name, goal, status,
    createdAt: Number.isFinite(created) ? created : undefined, memberCount,
    executionMode: text(project.executionMode, 80) || undefined,
    roomId: text(data.roomId, 256) || undefined,
    ...(typeof planning.sent === 'boolean' ? { planningStart: { sent: planning.sent } } : {}),
    project: { id, name, status } };
  let response = JSON.stringify(card);
  if (response.length > 10000) { card.goal = ''; response = JSON.stringify(card); }
  return response.length <= 10000 ? response : undefined;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
