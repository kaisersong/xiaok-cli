export type UiLocale = 'zh-CN' | 'en';
export declare function getToolActivityLabel(toolName: string, locale?: UiLocale): string;
export declare function getUiCopy(locale?: UiLocale): {
    readonly approvalTitle: "xiaok 想要执行以下操作";
    readonly subAgents: {
        readonly title: "SubAgent";
        readonly idle: "无活动";
        readonly cleaning: "关闭·清理中";
        readonly stalled: "等待退出·清理中";
        readonly collaboration: "SubAgent 协作";
        readonly arranging: "安排 SubAgent";
        readonly started: "开始";
        readonly assignment: "分工";
        readonly result: "交付摘要";
        readonly elapsed: "耗时";
        readonly tools: (count: number) => string;
        readonly failures: (count: number) => string;
        readonly round: (turn: number) => string;
        readonly constellations: readonly ["双鱼座", "天秤座", "白羊座", "金牛座", "双子座", "巨蟹座", "狮子座", "处女座", "天蝎座", "射手座", "摩羯座", "水瓶座"];
        readonly phases: {
            readonly starting: "初始化";
            readonly model: "模型请求";
            readonly thinking: "思考中";
            readonly tool: "工具执行";
        };
        readonly statuses: {
            readonly pending: "排队";
            readonly running: "运行中";
            readonly completed: "完成";
            readonly failed: "失败";
            readonly interrupted: "已中断";
            readonly closed: "已关闭";
        };
    };
    readonly toolLabel: "工具";
    readonly targetLabels: {
        readonly command: "命令";
        readonly file: "文件";
        readonly path: "路径";
        readonly pattern: "模式";
    };
    readonly ranCollapseNotice: "… 更多命令已折叠（完成后按 Ctrl+O 查看）";
    readonly hint: "数字直选  ↑↓ 切换  Enter 确认  Esc 取消";
} | {
    readonly approvalTitle: "xiaok wants to run";
    readonly subAgents: {
        readonly title: "SubAgent";
        readonly idle: "idle ";
        readonly cleaning: "closed·cleaning";
        readonly stalled: "awaiting exit·cleaning";
        readonly collaboration: "SubAgent collaboration";
        readonly arranging: "Arrange SubAgent";
        readonly started: "started";
        readonly assignment: "Assignment";
        readonly result: "Result summary";
        readonly elapsed: "elapsed";
        readonly tools: (count: number) => string;
        readonly failures: (count: number) => string;
        readonly round: (turn: number) => string;
        readonly constellations: readonly ["Pisces", "Libra", "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Scorpio", "Sagittarius", "Capricorn", "Aquarius"];
        readonly phases: {
            readonly starting: "starting";
            readonly model: "model request";
            readonly thinking: "thinking";
            readonly tool: "tool";
        };
        readonly statuses: {
            readonly pending: "queued";
            readonly running: "running";
            readonly completed: "completed";
            readonly failed: "failed";
            readonly interrupted: "interrupted";
            readonly closed: "closed";
        };
    };
    readonly toolLabel: "Tool";
    readonly targetLabels: {
        readonly command: "Command";
        readonly file: "File";
        readonly path: "Path";
        readonly pattern: "Pattern";
    };
    readonly ranCollapseNotice: "… More commands collapsed (press Ctrl+O after completion to view)";
    readonly hint: "1-5 select  Up/Down navigate  Enter confirm  Esc cancel";
};
