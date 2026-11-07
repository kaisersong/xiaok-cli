// @vitest-environment node
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {expect,it} from 'vitest';
import {resolveDesktopServiceScope} from '../../electron/desktop-service-scope.js';

it('keeps the existing persisted profile and workspace IDs when Main resolves scope before Services',()=>{
  const dataRoot=join(process.cwd(),'scope-fixture','..','scope-fixture'),workspaceRoot=join(process.cwd(),'workspace-fixture');
  const view=resolveDesktopServiceScope({dataRoot,workspaceRoot});
  // This is a compatibility oracle for the old persisted-key algorithm.
  expect(view.profileId).toBe(createHash('sha256').update(resolve(dataRoot)).digest('hex'));
  expect(view.workspaceId).toBe(createHash('sha256').update(resolve(workspaceRoot)).digest('hex'));
  expect(view.cwd).toBe(resolve(workspaceRoot));expect(Object.isFrozen(view)).toBe(true);
  expect(resolveDesktopServiceScope({dataRoot,workspaceRoot:join(workspaceRoot,'.')})).toEqual(view);
});
