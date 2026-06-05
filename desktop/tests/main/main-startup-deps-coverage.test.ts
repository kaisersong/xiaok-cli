import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const startupSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'main-startup.ts'), 'utf8');

describe('MainStartupDeps coverage', () => {
  it('interface declares all fields used in runMainStartup', () => {
    const interfaceMatch = startupSource.match(/export interface MainStartupDeps \{([\s\S]*?)\n\}/);
    expect(interfaceMatch).not.toBeNull();
    const interfaceBody = interfaceMatch![1];

    const declaredFields = [...interfaceBody.matchAll(/^\s+(\w+)\s*[:(]/gm)].map(m => m[1]);
    expect(declaredFields.length).toBeGreaterThan(0);

    const fnBody = startupSource.slice(startupSource.indexOf('export async function runMainStartup'));
    for (const field of declaredFields) {
      expect(fnBody, `MainStartupDeps.${field} is declared but never used in runMainStartup`).toContain(`deps.${field}`);
    }
  });

  it('runMainStartup uses no deps field not declared in the interface', () => {
    const fnBody = startupSource.slice(startupSource.indexOf('export async function runMainStartup'));
    const usedFields = [...new Set([...fnBody.matchAll(/deps\.(\w+)/g)].map(m => m[1]))];

    const interfaceMatch = startupSource.match(/export interface MainStartupDeps \{([\s\S]*?)\n\}/);
    const interfaceBody = interfaceMatch![1];
    const declaredFields = [...interfaceBody.matchAll(/^\s+(\w+)\s*[:(]/gm)].map(m => m[1]);

    for (const field of usedFields) {
      expect(declaredFields, `deps.${field} is used but not declared in MainStartupDeps`).toContain(field);
    }
  });
});
