export declare const A2UI_MIME_TYPE = "application/vnd.xiaok.a2ui+json";
export declare const SAFE_A2UI_CATALOG_ID = "xiaok-safe";
export declare const A2UI_PROTOCOL_VERSION = 1;
export type ValidationResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare const RENDER_UI_SECTION_KINDS: readonly ["heading", "text", "metric", "table", "list", "divider"];
export type RenderUISectionKind = typeof RENDER_UI_SECTION_KINDS[number];
export interface RenderUIInput {
    title: string;
    sections: RenderUISection[];
    data?: Record<string, unknown>;
    output_path?: string;
    task_id?: string;
}
export type RenderUISection = {
    kind: 'heading';
    text: string;
    level?: 1 | 2 | 3;
} | {
    kind: 'text';
    content: string;
} | {
    kind: 'metric';
    label: string;
    value: string | number;
    change?: string;
} | {
    kind: 'table';
    columns: string[];
    rows: unknown[][];
} | {
    kind: 'list';
    items: string[];
} | {
    kind: 'divider';
};
export type A2UIDynamicValue = {
    path: string;
};
export interface A2UIComponent {
    id: string;
    component: 'Text' | 'Row' | 'Column' | 'Card' | 'Divider' | 'List' | 'Table' | 'MetricCard';
    children?: string[];
    text?: string;
    variant?: 'h1' | 'h2' | 'h3' | 'body';
    label?: string;
    value?: string | number | A2UIDynamicValue;
    change?: string;
    columns?: string[];
    rows?: unknown[][] | A2UIDynamicValue;
    items?: string[];
    distribution?: 'start' | 'center' | 'end' | 'between';
    alignment?: 'start' | 'center' | 'end' | 'stretch';
}
export type A2UIMessage = {
    version: typeof A2UI_PROTOCOL_VERSION;
    createSurface: {
        surfaceId: string;
        catalogId: typeof SAFE_A2UI_CATALOG_ID;
        root: string;
    };
} | {
    version: typeof A2UI_PROTOCOL_VERSION;
    updateComponents: {
        surfaceId: string;
        components: A2UIComponent[];
    };
} | {
    version: typeof A2UI_PROTOCOL_VERSION;
    updateDataModel: {
        surfaceId: string;
        path: '';
        value: Record<string, unknown>;
    };
};
export interface CompiledA2UIArtifact {
    surfaceId: string;
    mimeType: typeof A2UI_MIME_TYPE;
    messages: A2UIMessage[];
    componentCount: number;
    payloadBytes: number;
}
export declare const A2UI_LIMITS: {
    readonly maxMessages: 50;
    readonly maxComponents: 100;
    readonly maxTreeDepth: 8;
    readonly maxChildrenPerNode: 20;
    readonly maxDataModelBytes: 500000;
    readonly maxSinglePropBytes: 100000;
    readonly maxStringLen: 10000;
    readonly maxTableRows: 200;
    readonly maxTableCols: 10;
    readonly maxTableCellLen: 1000;
    readonly maxMetricValueLen: 50;
    readonly maxSections: 30;
};
export declare function formatA2UIBytes(bytes: number): string;
export declare function isA2UIMimeType(value: unknown): boolean;
export declare function sanitizeA2UIIdPart(value: string): string;
export declare function summarizeRenderUiInput(input: unknown): {
    title: string;
    sectionCount: number;
    payloadBytes: number;
    summary: string;
};
