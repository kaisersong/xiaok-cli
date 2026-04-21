import type { Tool } from '../../types.js';
import { SessionTaskBoard } from '../../runtime/tasking/board.js';
import type { TaskStatus } from '../../runtime/tasking/types.js';

export interface TaskToolOptions {
  board: SessionTaskBoard;
  sessionId: string;
}

const VALID_STATUS: TaskStatus[] = [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
];

export function createTaskTools(options: TaskToolOptions): Tool[] {
  const { board, sessionId } = options;

  return [
    {
      permission: 'safe',
      definition: {
        name: 'task_create',
        description: '为当前会话创建一个可追踪任务项',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题' },
            details: { type: 'string', description: '任务详情（可选）' },
            owner: { type: 'string', description: '负责人（可选）' },
            objective: { type: 'string', description: '任务目标（可选）' },
            deliverable: { type: 'string', description: '预期交付物（可选）' },
            selected_skills: {
              type: 'array',
              items: { type: 'string' },
              description: '当前选中的 skill 列表（可选）',
            },
            acceptance_criteria: {
              type: 'array',
              items: { type: 'string' },
              description: '任务验收标准（可选）',
            },
          },
          required: ['title'],
        },
      },
      async execute(input) {
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!title) {
          return 'Error: title 不能为空';
        }

        const task = board.create(sessionId, {
          title,
          details: typeof input.details === 'string' ? input.details : undefined,
          owner: typeof input.owner === 'string' ? input.owner : undefined,
          objective: typeof input.objective === 'string' ? input.objective : undefined,
          deliverable: typeof input.deliverable === 'string' ? input.deliverable : undefined,
          selectedSkills: Array.isArray(input.selected_skills)
            ? input.selected_skills.filter((value): value is string => typeof value === 'string')
            : undefined,
          acceptanceCriteria: Array.isArray(input.acceptance_criteria)
            ? input.acceptance_criteria.filter((value): value is string => typeof value === 'string')
            : undefined,
        });
        return JSON.stringify(task, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_update',
        description: '更新当前会话中的任务状态、详情或进展',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: '任务 ID' },
            status: { type: 'string', enum: VALID_STATUS, description: '任务状态（可选）' },
            details: { type: 'string', description: '新的任务详情（可选）' },
            owner: { type: 'string', description: '新的负责人（可选）' },
            note: { type: 'string', description: '新的进展记录（可选）' },
            objective: { type: 'string', description: '新的任务目标（可选）' },
            deliverable: { type: 'string', description: '新的预期交付物（可选）' },
            selected_skills: {
              type: 'array',
              items: { type: 'string' },
              description: '新的 skill 列表（可选）',
            },
            acceptance_criteria: {
              type: 'array',
              items: { type: 'string' },
              description: '新的验收标准（可选）',
            },
            blocked_reason: { type: 'string', description: '阻塞原因（可选）' },
            increment_attempt: { type: 'boolean', description: '是否增加尝试次数（可选）' },
            last_tool_name: { type: 'string', description: '最近执行的 tool 名称（可选）' },
          },
          required: ['task_id'],
        },
      },
      async execute(input) {
        const taskId = typeof input.task_id === 'string' ? input.task_id : '';
        if (!taskId) {
          return 'Error: task_id 不能为空';
        }

        const rawStatus = typeof input.status === 'string' ? input.status : undefined;
        if (rawStatus && !VALID_STATUS.includes(rawStatus as TaskStatus)) {
          return `Error: 非法状态: ${rawStatus}`;
        }

        const updated = board.update(sessionId, taskId, {
          status: rawStatus as TaskStatus | undefined,
          details: typeof input.details === 'string' ? input.details : undefined,
          owner: typeof input.owner === 'string' ? input.owner : undefined,
          note: typeof input.note === 'string' ? input.note : undefined,
          objective: typeof input.objective === 'string' ? input.objective : undefined,
          deliverable: typeof input.deliverable === 'string' ? input.deliverable : undefined,
          selectedSkills: Array.isArray(input.selected_skills)
            ? input.selected_skills.filter((value): value is string => typeof value === 'string')
            : undefined,
          acceptanceCriteria: Array.isArray(input.acceptance_criteria)
            ? input.acceptance_criteria.filter((value): value is string => typeof value === 'string')
            : undefined,
          blockedReason: typeof input.blocked_reason === 'string' ? input.blocked_reason : undefined,
          incrementAttempt: input.increment_attempt === true,
          lastToolName: typeof input.last_tool_name === 'string' ? input.last_tool_name : undefined,
        });
        if (!updated) {
          return `Error: 未找到任务 ${taskId}`;
        }
        return JSON.stringify(updated, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_list',
        description: '列出当前会话中的任务',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: VALID_STATUS, description: '按状态过滤（可选）' },
            limit: { type: 'number', description: '返回数量上限（可选）' },
          },
          required: [],
        },
      },
      async execute(input) {
        const rawStatus = typeof input.status === 'string' ? input.status : undefined;
        const tasks = board.list(sessionId, {
          status: rawStatus as TaskStatus | undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return JSON.stringify(tasks, null, 2);
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'task_get',
        description: '查看当前会话中的某个任务详情',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: '任务 ID' },
          },
          required: ['task_id'],
        },
      },
      async execute(input) {
        const taskId = typeof input.task_id === 'string' ? input.task_id : '';
        if (!taskId) {
          return 'Error: task_id 不能为空';
        }

        const task = board.get(sessionId, taskId);
        if (!task) {
          return `Error: 未找到任务 ${taskId}`;
        }
        return JSON.stringify(task, null, 2);
      },
    },
  ];
}
