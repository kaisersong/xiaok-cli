import { createMemoryStoreAsync } from '../ai/memory/store.js';
import { createLLMFromAdapter } from '../ai/memory/layered-store.js';
import { createAdapter } from '../ai/models.js';
import { loadConfig } from '../utils/config.js';
export function registerMemoryCommands(program) {
    const mem = program
        .command('memory')
        .description('管理长期记忆系统');
    mem
        .command('stats')
        .description('显示记忆层统计信息')
        .action(async () => {
        const config = await loadConfig();
        const store = await createMemoryStoreAsync(config.memory);
        if (!store.getStats) {
            console.log('当前记忆后端不支持 stats');
            store.close?.();
            return;
        }
        const stats = store.getStats();
        console.log('记忆系统统计:');
        console.log(`  L0 原始消息:   ${stats.l0}`);
        console.log(`  L1 提取摘要:   ${stats.l1}`);
        console.log(`  L2 场景模式:   ${stats.l2}`);
        console.log(`  L3 人格特征:   ${stats.l3}`);
        console.log(`  数据库大小:    ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`);
        store.close?.();
    });
    mem
        .command('list')
        .description('显示最近的记忆条目')
        .option('-n, --limit <number>', '显示条数', '20')
        .action(async (opts) => {
        const config = await loadConfig();
        const store = await createMemoryStoreAsync(config.memory);
        const results = await store.listRelevant({ cwd: process.cwd(), query: '' });
        const limit = parseInt(opts.limit, 10) || 20;
        const items = results.slice(0, limit);
        if (items.length === 0) {
            console.log('暂无记忆条目。');
        }
        else {
            for (const item of items) {
                const tags = item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : '';
                console.log(`  ${item.id.slice(0, 8)}  ${item.title.slice(0, 60)}${tags}`);
            }
            console.log(`\n共 ${items.length} 条`);
        }
        store.close?.();
    });
    mem
        .command('search')
        .description('语义搜索记忆')
        .argument('<query>', '搜索关键词')
        .option('-n, --limit <number>', '返回条数', '10')
        .action(async (query, opts) => {
        const config = await loadConfig();
        const store = await createMemoryStoreAsync(config.memory);
        const limit = parseInt(opts.limit, 10) || 10;
        let results;
        if (store.search) {
            results = await store.search(query, limit);
        }
        else {
            results = await store.listRelevant({ cwd: process.cwd(), query });
            results = results.slice(0, limit);
        }
        if (results.length === 0) {
            console.log('未找到相关记忆。');
        }
        else {
            for (const item of results) {
                const tags = item.tags.length > 0 ? ` [${item.tags.join(', ')}]` : '';
                console.log(`  ${item.id.slice(0, 8)}  ${item.summary.slice(0, 80)}${tags}`);
            }
            console.log(`\n共 ${results.length} 条结果`);
        }
        store.close?.();
    });
    mem
        .command('compact')
        .description('手动触发记忆压缩')
        .action(async () => {
        const config = await loadConfig();
        const store = await createMemoryStoreAsync(config.memory);
        if (!store.compact) {
            console.log('当前记忆后端不支持 compaction');
            store.close?.();
            return;
        }
        try {
            const adapter = createAdapter(config);
            store.setLLMFn?.(createLLMFromAdapter(adapter));
        }
        catch (e) {
            console.error('无法初始化模型 adapter:', String(e));
            store.close?.();
            return;
        }
        console.log('正在压缩记忆...');
        await store.compact();
        console.log('压缩完成。');
        if (store.getStats) {
            const stats = store.getStats();
            console.log(`  L0: ${stats.l0} | L1: ${stats.l1} | L2: ${stats.l2} | L3: ${stats.l3}`);
        }
        store.close?.();
    });
    mem
        .command('clear')
        .description('清除所有记忆（不可恢复）')
        .option('-y, --yes', '跳过确认')
        .action(async (opts) => {
        if (!opts.yes) {
            const readline = await import('node:readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise(resolve => {
                rl.question('确认清除所有记忆？此操作不可恢复 (y/N): ', resolve);
            });
            rl.close();
            if (answer.toLowerCase() !== 'y') {
                console.log('已取消。');
                return;
            }
        }
        const config = await loadConfig();
        const store = await createMemoryStoreAsync(config.memory);
        if (!store.clearAll) {
            console.log('当前记忆后端不支持 clear');
            store.close?.();
            return;
        }
        store.clearAll();
        console.log('所有记忆已清除。');
        store.close?.();
    });
}
