export type UiLocale = 'zh-CN' | 'en';
export declare function getToolActivityLabel(toolName: string, locale?: UiLocale): string;
export declare function getUiCopy(locale?: UiLocale): {
    readonly approvalTitle: "xiaok 想要执行以下操作";
    readonly toolLabel: "工具";
    readonly targetLabels: {
        readonly command: "命令";
        readonly file: "文件";
        readonly path: "路径";
        readonly pattern: "模式";
    };
    readonly hint: "↑↓ 选择  Enter 确认  Esc 取消";
} | {
    readonly approvalTitle: "xiaok wants to run";
    readonly toolLabel: "Tool";
    readonly targetLabels: {
        readonly command: "Command";
        readonly file: "File";
        readonly path: "Path";
        readonly pattern: "Pattern";
    };
    readonly hint: "Up/Down select  Enter confirm  Esc cancel";
};
