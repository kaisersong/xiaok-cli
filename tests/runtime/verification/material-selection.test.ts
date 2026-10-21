import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectExplicitValidationFiles} from '../../../src/runtime/verification/material-selection.js';
it('resolves only individually selected files under actual user filesystem permissions',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'validation-selection-')));
 try{writeFileSync(join(root,'source.ts'),'source');writeFileSync(join(root,'not-selected.env'),'secret');
 expect(selectExplicitValidationFiles(['source.ts'],root)).toEqual([{path:join(root,'source.ts'),byteLimit:6}]);
 expect(()=>selectExplicitValidationFiles(['.'],root)).toThrow(/regular_file/);
 expect(()=>selectExplicitValidationFiles(['*.ts'],root)).toThrow();
 symlinkSync(join(root,'source.ts'),join(root,'alias.ts'));
 expect(()=>selectExplicitValidationFiles(['source.ts','alias.ts'],root)).toThrow(/duplicate/);
 expect(()=>selectExplicitValidationFiles([],root)).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
