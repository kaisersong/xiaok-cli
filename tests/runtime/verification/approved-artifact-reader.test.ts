import {it,expect} from 'vitest';
import {createApprovedRecipeArtifactReader} from '../../../src/runtime/verification/approved-artifact-reader.js';
it('rejects an unapproved path before archive I/O and never accepts an output DTO',async()=>{
 const expected={sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'e',scopeDigest:'a'.repeat(64)},output={},receipt={};let reads=0;
 const reader=createApprovedRecipeArtifactReader({raw:{readCapturedOutput(value:object){if(value!==output)throw Error('opaque output');return {};},async readArchive(){reads++;throw Error('must not read');}},quiescence:{assertQuiescent(value:object){if(value!==receipt)throw Error('receipt');}},readApprovedRecipeBinding(){return {attempt:{expected},recipe:{kind:'artifact-content',checks:[{id:'c',path:'allowed',sha256:'b'.repeat(64),structure:'bytes'}]}};}} as any);
 expect(()=>reader.registerActualOutput({expected,output:{},receipt} as any)).toThrow('opaque output');reader.registerActualOutput({expected,output,receipt} as any);
 await expect(reader.readArtifact({attemptId:'a',subjectId:'s',runNonce:'n',expected},'other')).rejects.toThrow('recipe_artifact_path');expect(reads).toBe(0);
});
