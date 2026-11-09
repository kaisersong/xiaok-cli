import type {Tool} from '../../types.js';
import type {ToolDescriptionMetadata} from '../../shared/tool-description-metadata.js';
import {buildToolList} from './index.js';
import {getBuiltinToolIdentity} from './native-tool-identity.js';
import {createSandboxPolicy} from '../../platform/sandbox/policy.js';
import {createSandboxEnforcer} from '../../platform/sandbox/enforcer.js';
import {applySandboxToTools} from '../../platform/sandbox/tool-wrappers.js';

/** Shared production factory for readonly model roles. An empty reference set
 * grants no tools; it must never become an unrestricted empty allowlist. This
 * scope is not an immutable snapshot, egress permit or DSH qualification. */
export function buildScopedNativeReadonlyTools(workspace:{cwd:string;readOnlyPaths:readonly string[]},metadata?:Map<Tool,ToolDescriptionMetadata>):Tool[] {
  if(!Array.isArray(workspace.readOnlyPaths)||workspace.readOnlyPaths.some(path=>typeof path!=='string'||!path))throw Error('native_readonly_scope_required');
  const paths=[...workspace.readOnlyPaths];
  if(paths.length===0)return [];
  const tools=buildToolList(undefined,{cwd:workspace.cwd,readOnlyPaths:paths,maxReadBytes:4*1024*1024},[],metadata).filter(tool=>getBuiltinToolIdentity(tool)==='readonly');
  const wrapped=applySandboxToTools(tools,createSandboxEnforcer(createSandboxPolicy({pathAllowlist:paths,network:'deny'})));
  for(let index=0;index<tools.length;index++) {const description=metadata?.get(tools[index]);if(description)metadata!.set(wrapped[index],description);}
  return wrapped;
}
