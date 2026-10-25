import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {reserveCompoundDomainBytes,COMPOUND_DOMAIN_RESERVED_BYTES} from '../../../src/runtime/sol-pi/compound-domain-budget.js';
const roots:string[]=[];
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'domain-budget-'));roots.push(root);return root;}
it('does not discount old domain bytes when activation is off',()=>{
 const root=fixture();expect(reserveCompoundDomainBytes(root)).toBe(0);expect(reserveCompoundDomainBytes(root,true)).toBe(COMPOUND_DOMAIN_RESERVED_BYTES);
 mkdirSync(join(root,'compound-domains'));expect(reserveCompoundDomainBytes(root)).toBe(COMPOUND_DOMAIN_RESERVED_BYTES);
});
it.each([false,true])('rejects unknown or oversized existing files before profile budget acceptance (activation %s)',active=>{
 const root=fixture(),dir=join(root,'compound-domains');mkdirSync(dir);const path=join(dir,'index.json');
 writeFileSync(path,Buffer.alloc(COMPOUND_DOMAIN_RESERVED_BYTES+1));expect(()=>reserveCompoundDomainBytes(root,active)).toThrow();
 rmSync(path);writeFileSync(join(dir,'unowned-file'),'preserve me');expect(()=>reserveCompoundDomainBytes(root,active)).toThrow();
});
it('rejects symlink namespaces instead of discounting an absent target',()=>{
 const root=fixture();symlinkSync(join(root,'missing'),join(root,'compound-domains'));expect(()=>reserveCompoundDomainBytes(root)).toThrow();
});
