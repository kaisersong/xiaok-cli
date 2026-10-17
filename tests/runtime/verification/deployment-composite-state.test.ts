import {it,expect} from 'vitest';
import {initializeInstalledCompositeState} from '../../../src/runtime/verification/deployment-composite-state.js';
it('refuses ordinary accounts and invalid identity before filesystem or account mutation',()=>{
 if(process.getuid?.()!==0)expect(()=>initializeInstalledCompositeState('a'.repeat(64),402,403)).toThrow('root_required');
 else expect(()=>initializeInstalledCompositeState('a'.repeat(64),402,402)).toThrow();
});
