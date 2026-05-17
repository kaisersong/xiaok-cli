import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
export function checkArtifactSmoke(input) {
    const resolvedArtifactPath = resolve(input.artifactPath);
    const errors = [];
    if (!existsSync(resolvedArtifactPath)) {
        return {
            ok: false,
            artifactPath: input.artifactPath,
            resolvedArtifactPath,
            kind: resolveArtifactKind(resolvedArtifactPath, input.expectedKind),
            sizeBytes: 0,
            errors: ['artifact file does not exist'],
        };
    }
    const stats = statSync(resolvedArtifactPath);
    if (!stats.isFile()) {
        errors.push('artifact path is not a regular file');
    }
    if (stats.size <= 0) {
        errors.push('artifact file is empty');
    }
    const normalizedSources = (input.sourcePaths ?? []).map((path) => resolve(path));
    if (normalizedSources.includes(resolvedArtifactPath)) {
        errors.push('artifact path matches a provided source path');
    }
    const kind = resolveArtifactKind(resolvedArtifactPath, input.expectedKind);
    if (stats.isFile() && stats.size > 0) {
        validateStructure(kind, resolvedArtifactPath, errors);
    }
    return {
        ok: errors.length === 0,
        artifactPath: input.artifactPath,
        resolvedArtifactPath,
        kind,
        sizeBytes: stats.size,
        errors,
    };
}
export function resolveArtifactKind(artifactPath, expectedKind = 'auto') {
    if (expectedKind !== 'auto') {
        return expectedKind;
    }
    const normalized = artifactPath.toLowerCase();
    if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
        return 'markdown';
    }
    if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
        return 'html';
    }
    if (normalized.endsWith('.json')) {
        return 'json';
    }
    if (normalized.endsWith('.pptx')) {
        return 'pptx';
    }
    return 'unknown';
}
function validateStructure(kind, artifactPath, errors) {
    if (kind === 'pptx') {
        validatePptx(artifactPath, errors);
        return;
    }
    const content = readFileSync(artifactPath, 'utf8');
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        errors.push('artifact file only contains whitespace');
        return;
    }
    if (kind === 'markdown') {
        validateMarkdown(trimmed, errors);
        return;
    }
    if (kind === 'html') {
        validateHtml(trimmed, errors);
        return;
    }
    if (kind === 'json') {
        validateJson(trimmed, errors);
    }
}
function validateMarkdown(content, errors) {
    const hasSignal = /[#*_`>\-\d]/.test(content) || content.split(/\s+/).length >= 3;
    if (!hasSignal) {
        errors.push('markdown artifact is missing basic content structure');
    }
}
function validateHtml(content, errors) {
    const normalized = content.toLowerCase();
    const hasHtmlShell = normalized.includes('<html') || normalized.includes('<!doctype html');
    const hasContentRoot = normalized.includes('<body') || normalized.includes('<main') || normalized.includes('<article');
    if (!hasHtmlShell) {
        errors.push('html artifact is missing an html shell');
    }
    if (!hasContentRoot) {
        errors.push('html artifact is missing a body-like content root');
    }
}
function validateJson(content, errors) {
    try {
        JSON.parse(content);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`json artifact failed to parse: ${message}`);
    }
}
function validatePptx(artifactPath, errors) {
    const signature = readFileSync(artifactPath).subarray(0, 2).toString('utf8');
    if (signature !== 'PK') {
        errors.push('pptx artifact is missing the expected zip header');
    }
}
