import { basename, dirname, extname, join } from 'node:path';
const SOURCE_PATH_PATTERN = /(?:^|[\s，。！？；：、,!?;:])(?:"((?:\/|[a-zA-Z]:[\\/])[^"]+)"|'((?:\/|[a-zA-Z]:[\\/])[^']+)'|((?:\/|[a-zA-Z]:[\\/])\S+))/gu;
export function extractProvidedSourcePaths(rawIntent) {
    const matches = Array.from(rawIntent.matchAll(SOURCE_PATH_PATTERN));
    const paths = matches
        .map((match) => normalizeExtractedPath(match[1] ?? match[2] ?? match[3] ?? ''))
        .filter(Boolean);
    return Array.from(new Set(paths));
}
export function stripProvidedSourcePaths(rawIntent, sourcePaths) {
    let next = rawIntent;
    for (const sourcePath of sourcePaths) {
        next = next.replace(sourcePath, ' ');
    }
    return next.replace(/\s+/gu, ' ').trim();
}
export function buildSuggestedOutputPaths(input) {
    const sourcePaths = input.sourcePaths ?? [];
    const stages = input.stages ?? [];
    if (sourcePaths.length !== 1 || stages.length === 0) {
        return [];
    }
    const anchorPath = sourcePaths[0];
    const sourceDir = dirname(anchorPath);
    const sourceStem = basename(anchorPath, extname(anchorPath));
    const usedPaths = new Set(sourcePaths);
    const suggestions = [];
    for (const stage of stages) {
        const extension = inferSuggestedExtension(stage.deliverable);
        if (!extension) {
            continue;
        }
        const suffix = inferSuggestedSuffix(stage.deliverable);
        const baseCandidate = join(sourceDir, `${sourceStem}${extension}`);
        const safePath = allocateSafeOutputPath(baseCandidate, suffix, extension, usedPaths);
        usedPaths.add(safePath);
        suggestions.push({
            stageId: stage.stageId,
            deliverable: stage.deliverable,
            path: safePath,
        });
    }
    return suggestions;
}
function normalizeExtractedPath(value) {
    return value
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[，。！？；,!?;]+$/u, '');
}
function inferSuggestedExtension(deliverable) {
    if (/(^|[^a-z])(md|markdown)([^a-z]|$)/iu.test(deliverable)) {
        return '.md';
    }
    if (/(报告|report|dashboard|看板|slides|slide deck|幻灯片|deck)/iu.test(deliverable)) {
        return '.html';
    }
    if (/(总结|摘要|纪要|结论|analysis|分析|方案|proposal|brief|提纲|文案|说明|稿)/iu.test(deliverable)) {
        return '.md';
    }
    return null;
}
function inferSuggestedSuffix(deliverable) {
    if (/(^|[^a-z])(md|markdown)([^a-z]|$)/iu.test(deliverable)) {
        return 'md';
    }
    if (/(报告|report|dashboard|看板)/iu.test(deliverable)) {
        return 'report';
    }
    if (/(slides|slide deck|幻灯片|deck)/iu.test(deliverable)) {
        return 'slides';
    }
    if (/(总结|摘要|纪要|结论)/u.test(deliverable)) {
        return 'summary';
    }
    if (/(analysis|分析|测算|评估)/iu.test(deliverable)) {
        return 'analysis';
    }
    if (/(方案|proposal|brief|提纲|文案|说明|稿)/iu.test(deliverable)) {
        return 'draft';
    }
    return 'output';
}
function allocateSafeOutputPath(baseCandidate, suffix, extension, usedPaths) {
    if (!usedPaths.has(baseCandidate)) {
        return baseCandidate;
    }
    const stem = baseCandidate.slice(0, -extension.length);
    let attempt = `${stem}-${suffix}${extension}`;
    let counter = 2;
    while (usedPaths.has(attempt)) {
        attempt = `${stem}-${suffix}-${counter}${extension}`;
        counter += 1;
    }
    return attempt;
}
