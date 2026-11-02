import { describe, it, expect } from 'vitest';
describe('outer > label', () => {
 describe('nested [suite]', () => {
  it.each(['a+b','line\nbreak','(x)? $ ^'])('case %s', value => expect(value).toBeTruthy());
  it.skip('natural skip', () => {throw new Error('must not execute');});
 });
});
