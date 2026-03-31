export function createTeamTools(service) {
    return [
        {
            permission: 'safe',
            definition: {
                name: 'team_create',
                description: '创建 agent team，供多代理协作和消息交换使用',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        owner: { type: 'string' },
                        members: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['name', 'owner', 'members'],
                },
            },
            async execute(input) {
                const team = service.createTeam({
                    name: String(input.name),
                    owner: String(input.owner),
                    members: Array.isArray(input.members)
                        ? input.members.filter((entry) => typeof entry === 'string')
                        : [],
                });
                return `team created: ${team.teamId} (${team.name})`;
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'team_delete',
                description: '删除 agent team',
                inputSchema: {
                    type: 'object',
                    properties: {
                        team_id: { type: 'string' },
                    },
                    required: ['team_id'],
                },
            },
            async execute(input) {
                service.deleteTeam(String(input.team_id));
                return `team deleted: ${String(input.team_id)}`;
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'team_message',
                description: '向 team channel 发送成员间消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        team_id: { type: 'string' },
                        from: { type: 'string' },
                        to: { type: 'string' },
                        body: { type: 'string' },
                    },
                    required: ['team_id', 'from', 'to', 'body'],
                },
            },
            async execute(input) {
                const message = service.sendMessage({
                    teamId: String(input.team_id),
                    from: String(input.from),
                    to: String(input.to),
                    body: String(input.body),
                });
                return `team message sent: ${message.messageId}`;
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'team_list_messages',
                description: '查看 team channel 历史消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        team_id: { type: 'string' },
                    },
                    required: ['team_id'],
                },
            },
            async execute(input) {
                const messages = service.listMessages(String(input.team_id));
                return JSON.stringify(messages, null, 2);
            },
        },
    ];
}
