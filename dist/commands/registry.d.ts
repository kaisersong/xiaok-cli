import type { SkillMeta } from '../ai/skills/loader.js';
export interface ChatCommandMetadata {
    id: string;
    cmd: string;
    slashDesc: string;
    helpLine: string;
    showInSlash: boolean;
    showInHelp: boolean;
}
export declare function listChatCommandMetadata(): ChatCommandMetadata[];
export declare function getChatSlashCommands(): Array<{
    cmd: string;
    desc: string;
}>;
export declare function getChatHelpLines(): string[];
export declare function buildChatHelpText(skills: SkillMeta[]): string;
