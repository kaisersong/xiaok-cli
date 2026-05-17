import { describe, expect, it } from 'vitest';

import { canRetryPlanForProject } from '../../renderer/src/components/projects/projectPlanRecovery';

function project(status: string) {
  return { id: 'proj-test', name: 'Test Project', status };
}

describe('project plan retry recovery', () => {
  it.each(['draft', 'created', 'planning'])('allows retry while project is %s', (status) => {
    expect(canRetryPlanForProject(project(status), null, [])).toBe(true);
  });

  it('allows retry for an empty active project with no plan', () => {
    expect(canRetryPlanForProject(project('active'), null, [])).toBe(true);
  });

  it('does not allow retry for active projects that already have work', () => {
    expect(canRetryPlanForProject(project('active'), { version: 1 }, [])).toBe(false);
    expect(canRetryPlanForProject(project('active'), null, [{ id: 'task-1', status: 'pending' }])).toBe(false);
  });

  it.each(['review', 'delivered', 'closed'])('blocks retry while project is %s', (status) => {
    expect(canRetryPlanForProject(project(status), null, [])).toBe(false);
  });
});
