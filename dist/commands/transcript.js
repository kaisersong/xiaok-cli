import { analyzeTranscriptEvents, loadTranscriptEvents } from '../ui/transcript.js';
export async function runTranscriptCommand(sessionId) {
    const events = loadTranscriptEvents(sessionId);
    const analysis = analyzeTranscriptEvents(events);
    return [
        'Transcript Analysis',
        '',
        `- sessionId=${sessionId}`,
        `- events=${events.length}`,
        `- slashPromptGrowth=${analysis.slashPromptGrowth}`,
        `- approvalTitleRepeats=${analysis.approvalTitleRepeats}`,
    ].join('\n');
}
export function registerTranscriptCommands(program) {
    program
        .command('transcript')
        .description('分析会话 transcript，检查交互与执行质量')
        .argument('<sessionId>', '会话 ID')
        .action(async (sessionId) => {
        console.log(await runTranscriptCommand(sessionId));
    });
}
