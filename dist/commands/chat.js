import * as readline from 'readline';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { ToolRegistry, buildToolList } from '../ai/tools/index.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { writeChunk, writeLine, writeError, isTTY, confirm } from '../utils/ui.js';
import { loadSkills, parseSlashCommand } from '../ai/skills/loader.js';
import { createSkillTool } from '../ai/skills/tool.js';
async function runChat(initialInput, opts) {
    // 检测 CI 环境
    const autoMode = opts.auto || !isTTY();
    if (!isTTY() && !opts.auto) {
        console.warn('\x1b[33m[警告]\x1b[0m stdin 非 TTY，自动切换为 --auto 模式');
    }
    // 加载配置和凭据
    const config = await loadConfig();
    let adapter;
    try {
        adapter = createAdapter(config);
    }
    catch (e) {
        writeError(String(e));
        process.exit(1);
    }
    const creds = await loadCredentials();
    const devApp = await getDevAppIdentity();
    // 加载 skills
    const skills = await loadSkills();
    const skillTool = createSkillTool(skills);
    const tools = buildToolList(skillTool);
    // 构建系统提示
    const systemPrompt = await buildSystemPrompt({
        enterpriseId: creds?.enterpriseId ?? null,
        devApp,
        cwd: process.cwd(),
        budget: config.contextBudget,
        skills,
    });
    // 创建 registry
    // rl 在交互模式下赋值，confirm() 复用它避免 stdin 嵌套冲突；
    // 单次任务模式下 rl 保持未赋值，confirm() 内部会创建临时接口（仅作兜底）
    let rl;
    const registry = new ToolRegistry({
        autoMode,
        dryRun: opts.dryRun,
        onPrompt: async (name, input) => {
            return confirm(name, input, () => registry.enableAutoMode(), rl ?? undefined);
        },
    }, tools);
    const agent = new Agent(adapter, registry, systemPrompt);
    // 单次任务模式
    if (initialInput) {
        process.stdout.write('\n');
        try {
            await agent.runTurn(initialInput, (chunk) => {
                if (chunk.type === 'text')
                    writeChunk(chunk.delta);
            });
        }
        catch (e) {
            writeError(String(e));
            process.exit(1);
        }
        process.stdout.write('\n');
        return;
    }
    // 交互模式
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    writeLine('\x1b[36mxiaok\x1b[0m - 云之家 AI 编程助手。输入 /exit 或 Ctrl-C 退出。');
    if (opts.dryRun)
        writeLine('\x1b[33m[dry-run 模式]\x1b[0m 工具调用不会实际执行。');
    // SIGINT 处理
    process.on('SIGINT', () => {
        writeLine('\n已退出。');
        rl.close();
        process.exit(0);
    });
    const askQuestion = () => {
        rl.question('\n\x1b[36m> \x1b[0m', async (input) => {
            const trimmed = input.trim();
            if (!trimmed || trimmed === '/exit') {
                writeLine('再见！');
                rl.close();
                return;
            }
            // 斜杠命令：直接触发对应 skill
            const slash = parseSlashCommand(trimmed);
            if (slash) {
                const skill = skills.find(s => s.name === slash.skillName);
                if (skill) {
                    const userMsg = slash.rest
                        ? `执行以下 skill，用户补充说明：${slash.rest}\n\n${skill.content}`
                        : skill.content;
                    process.stdout.write('\n');
                    try {
                        await agent.runTurn(userMsg, (chunk) => {
                            if (chunk.type === 'text')
                                writeChunk(chunk.delta);
                        });
                    }
                    catch (e) {
                        writeError(String(e));
                    }
                    process.stdout.write('\n');
                }
                else {
                    writeLine(`找不到 skill "${slash.skillName}"。可用 skills：${skills.map(s => '/' + s.name).join(', ') || '（无）'}`);
                }
                askQuestion();
                return;
            }
            // 普通输入
            process.stdout.write('\n');
            try {
                await agent.runTurn(trimmed, (chunk) => {
                    if (chunk.type === 'text')
                        writeChunk(chunk.delta);
                });
            }
            catch (e) {
                writeError(String(e));
            }
            process.stdout.write('\n');
            askQuestion();
        });
    };
    askQuestion();
}
export function registerChatCommands(program) {
    program
        .command('chat', { isDefault: true })
        .description('启动 AI 编程助手（默认命令）')
        .option('--auto', '自动执行所有工具，无需确认（适用于 CI）')
        .option('--dry-run', '打印工具调用但不执行')
        .argument('[input]', '单次任务描述（省略则进入交互模式）')
        .action(async (input, opts) => {
        await runChat(input, opts);
    });
}
