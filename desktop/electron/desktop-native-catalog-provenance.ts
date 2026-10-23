import type {Tool} from '../../src/types.js';
import {getBuiltinToolIdentity,inheritBuiltinToolIdentity,isNativeReadonlyExecutionEligible} from '../../src/ai/tools/native-tool-identity.js';
import type {DesktopCapabilityDescriptor} from './desktop-multi-agent-capabilities.js';
const sources=new WeakMap<DesktopCapabilityDescriptor,Tool>();
/** Only the fixed Desktop bridge calls this for its audited builtin readonly binding. */
export function bindDesktopNativeReadonlyDescriptor(descriptor:DesktopCapabilityDescriptor,source:Tool):void{
 if(getBuiltinToolIdentity(source)!=='readonly')throw Error('desktop_native_source_identity');
 if(sources.has(descriptor))throw Error('desktop_native_descriptor_duplicate');
 sources.set(descriptor,source);
}
export function inheritDesktopNativeReadonlyDescriptor(descriptor:DesktopCapabilityDescriptor,target:Tool):void{
 const source=sources.get(descriptor);if(!source)return;
 if(getBuiltinToolIdentity(source)!=='readonly')throw Error('desktop_native_source_identity');
 inheritBuiltinToolIdentity(source,target,()=>isNativeReadonlyExecutionEligible(source));
}
/** Revalidate the original real tool immediately before the scoped effect. */
export function assertDesktopNativeDescriptorCurrent(descriptor:DesktopCapabilityDescriptor):void{
 const source=sources.get(descriptor);if(source&&getBuiltinToolIdentity(source)!=='readonly')throw Error('desktop_native_source_identity');
}
