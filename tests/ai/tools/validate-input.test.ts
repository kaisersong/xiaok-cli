import { describe, it, expect } from 'vitest';
import { validateToolInput } from '../../../src/ai/tools/validate-input.js';

describe('validateToolInput', () => {
  it('passes when all required fields are present', () => {
    const result = validateToolInput(
      { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      { command: 'ls' },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when a required field is missing', () => {
    const result = validateToolInput(
      { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('missing required field: command');
  });

  it('fails when a field has wrong type', () => {
    const result = validateToolInput(
      { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      { command: 123 },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected string');
  });

  it('allows unknown fields', () => {
    const result = validateToolInput(
      { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      { command: 'ls', extra: true },
    );
    expect(result.valid).toBe(true);
  });

  it('validates array type', () => {
    const result = validateToolInput(
      { type: 'object', properties: { items: { type: 'array' } } },
      { items: 'not-array' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected array');
  });

  it('passes with no schema constraints', () => {
    const result = validateToolInput(
      { type: 'object' },
      { anything: 'goes' },
    );
    expect(result.valid).toBe(true);
  });
});
