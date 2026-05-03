import { describe, expect, it } from 'vitest';
import config from '../../vite.config.js';

describe('desktop renderer Vite config', () => {
  it('uses relative asset URLs so packaged loadFile can render the app', () => {
    expect(config).toMatchObject({
      base: './',
    });
  });
});
