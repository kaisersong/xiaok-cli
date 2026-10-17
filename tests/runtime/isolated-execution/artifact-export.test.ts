import {openPrivateVerificationDatabase as openArtifactTestDatabase} from '../../../src/runtime/verification/private-database.js';
import {it,expect,vi} from 'vitest';import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {extractSingleArtifact} from '../../../src/runtime/isolated-execution/artifact-export.js';
function tar(files:(root:string)=>void,names:string[],format='ustar'){const root=mkdtempSync(join(tmpdir(),'artifact-tar-'));try{files(root);const archive=join(root,'archive.tar');const command=spawnSync('/usr/bin/tar',['--format='+format,'-cf',archive,'-C',root,...names],{encoding:'utf8'});if(command.status!==0)throw Error(command.stderr);return readFileSync(archive);}finally{rmSync(root,{recursive:true,force:true});}}
it('extracts exact regular bytes from actual tar, rejecting links, additional members and truncated trailers',()=>{
 const data=tar(root=>writeFileSync(join(root,'report.txt'),'artifact bytes'),['report.txt']);expect(extractSingleArtifact(data,'nested/report.txt')).toEqual(Buffer.from('artifact bytes'));
 const link=tar(root=>{writeFileSync(join(root,'secret.txt'),'secret');symlinkSync('secret.txt',join(root,'report.txt'));},['report.txt']);expect(()=>extractSingleArtifact(link,'report.txt')).toThrow(/regular/);
 const extra=tar(root=>{writeFileSync(join(root,'report.txt'),'report');writeFileSync(join(root,'extra'),'extra');},['report.txt','extra']);expect(()=>extractSingleArtifact(extra,'report.txt')).toThrow(/member/);
 expect(()=>extractSingleArtifact(data.subarray(0,1024),'report.txt')).toThrow(/truncated/);
 expect(()=>extractSingleArtifact(data,'other.txt')).toThrow(/path/);
 const broken=Buffer.from(data);broken[0]^=1;expect(()=>extractSingleArtifact(broken,'report.txt')).toThrow(/checksum/);
});

it('accepts actual bounded PAX Unicode names while preserving the exact requested file binding',()=>{
 const name='report-中文.txt',data=tar(root=>writeFileSync(join(root,name),'Unicode artifact'),[name],'pax');
 expect(extractSingleArtifact(data,'nested/'+name).toString()).toBe('Unicode artifact');
 expect(()=>extractSingleArtifact(data,'other.txt')).toThrow(/path/);
});
it('persists immutable exports with shared reservations and restores only through an actual read authorization',async()=>{
 const {createArtifactExporter}=await import('../../../src/runtime/isolated-execution/artifact-export.js');
 const {createPrimitiveBlobAuthority}=await import('../../support/primitive-blob-authority.js');
 const root=mkdtempSync(join(tmpdir(),'artifact-export-')),archive=tar(dir=>writeFileSync(join(dir,'report.txt'),'immutable result'),['report.txt']);
 const H='a'.repeat(64),expected={sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'e',scopeDigest:H},receipt={},output={},readAuthorization={},deleteAuthorization={};
 let exporter:ReturnType<typeof createArtifactExporter>;
 const db=openArtifactTestDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'artifact-export',assertCurrent(){},deletion:{assertDeleted(proof:any,resource:any){if(!exporter)throw Error('no exporter');exporter.deletionAuthority.assertDeleted(proof,resource);}}}).budget;
 const options={root,database:db,budget,assertCurrent:()=>{},quiescence:{assertQuiescent:(r:object)=>{if(r!==receipt)throw Error('receipt');}},readArchive:async(o:object)=>{if(o!==output)throw Error('binding');return archive;},access:{assertExport:(facts:any,o:object,source:string)=>{if(facts.ownerKey!=='owner'||o!==output||source!=='agent')throw Error('export_authorization');},assertRead:(_facts:unknown,auth:object)=>{if(auth!==readAuthorization)throw Error('read_authorization');},assertDelete:(_facts:unknown,auth:object)=>{if(auth!==deleteAuthorization)throw Error('delete_authorization');}}};
 exporter=createArtifactExporter(options);
 try{
 const batch=await exporter.exportArtifacts({requestSource:'agent',ownerKey:'owner',output,expected,receipt:receipt as never,paths:['nested/report.txt']});
 expect(batch.artifacts).toHaveLength(1);expect(()=>exporter.openArtifact(batch.resourceId,'nested/report.txt',{})).toThrow(/authorization/);
 const handle=exporter.openArtifact(batch.resourceId,'nested/report.txt',readAuthorization);expect(exporter.readArtifact(handle).toString()).toBe('immutable result');
 expect(()=>exporter.readArtifact(JSON.parse(JSON.stringify(handle)))).toThrow(/identity/);
 exporter.close();exporter=createArtifactExporter(options);
 expect(exporter.readArtifact(exporter.openArtifact(batch.resourceId,'nested/report.txt',readAuthorization)).toString()).toBe('immutable result');
 expect(()=>exporter.deleteBatch(batch.resourceId,{requestSource:'user',authorization:{}})).toThrow(/authorization/);
 exporter.deleteBatch(batch.resourceId,{requestSource:'user',authorization:deleteAuthorization});
 expect(()=>exporter.openArtifact(batch.resourceId,'nested/report.txt',readAuthorization)).toThrow(/unavailable/);
 }finally{exporter.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});

it('repeats the real deletion directory barrier after a previous rmdir followed by fsync failure',async()=>{
 const atomic=await import('../../../src/utils/atomic-file.js');
 const {createArtifactExporter}=await import('../../../src/runtime/isolated-execution/artifact-export.js');
 const {createPrimitiveBlobAuthority}=await import('../../support/primitive-blob-authority.js');
 const {openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');
 const root=mkdtempSync(join(tmpdir(),'artifact-delete-')),archive=tar(dir=>writeFileSync(join(dir,'a'),'bytes'),['a']);
 const H='a'.repeat(64),expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'e',scopeDigest:H};
 let exporter:ReturnType<typeof createArtifactExporter>;
 const db=openArtifactTestDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'artifact-export',assertCurrent(){},deletion:{assertDeleted(proof:any,resource:any){exporter.deletionAuthority.assertDeleted(proof,resource);}}}).budget;
 exporter=createArtifactExporter({root,database:db,budget,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArchive:async()=>archive,access:{assertExport:()=>{},assertRead:()=>{},assertDelete:()=>{}}});
 const inspector=openPrivateVerificationDatabase(root);
 try{
 const batch=await exporter.exportArtifacts({requestSource:'agent',ownerKey:'owner',output:{},expected,receipt:{} as never,paths:['a']});
 const failure=vi.spyOn(atomic,'syncDirectoryTreeStrict').mockImplementation(()=>{throw Error('injected_directory_sync');});
 try{
 expect(()=>exporter.deleteBatch(batch.resourceId,{requestSource:'user',authorization:{}})).toThrow('injected_directory_sync');
 expect(()=>exporter.deleteBatch(batch.resourceId,{requestSource:'user',authorization:{}})).toThrow('injected_directory_sync');
 expect(inspector.prepare('SELECT state FROM verification_blob_reservations WHERE resource_id=?').get(batch.resourceId)).toEqual({state:'reserved'});
 }finally{failure.mockRestore();}
 exporter.deleteBatch(batch.resourceId,{requestSource:'user',authorization:{}});
 expect(inspector.prepare('SELECT state FROM verification_blob_reservations WHERE resource_id=?').get(batch.resourceId)).toEqual({state:'released'});
 }finally{inspector.close();exporter.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('rolls back the actual blob reservation when durable export intent insertion fails',async()=>{
 const {createArtifactExporter}=await import('../../../src/runtime/isolated-execution/artifact-export.js');
 const {createPrimitiveBlobAuthority}=await import('../../support/primitive-blob-authority.js');
 const {openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');
 const root=mkdtempSync(join(tmpdir(),'artifact-intent-')),archive=tar(dir=>writeFileSync(join(dir,'a'),'bytes'),['a']);
 const H='a'.repeat(64),expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'e',scopeDigest:H};
 const db=openArtifactTestDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'artifact-export',assertCurrent(){},deletion:{assertDeleted(){throw Error('not deleted');}}}).budget;
 const exporter=createArtifactExporter({root,database:db,budget,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArchive:async()=>archive,access:{assertExport:()=>{},assertRead:()=>{},assertDelete:()=>{}}});
 const inspector=openPrivateVerificationDatabase(root);try{
 inspector.exec("CREATE TRIGGER reject_artifact_intent BEFORE INSERT ON verification_artifact_batches BEGIN SELECT RAISE(ABORT,'intent_failure'); END");
 await expect(exporter.exportArtifacts({requestSource:'agent',ownerKey:'owner',output:{},expected,receipt:{} as never,paths:['a']})).rejects.toThrow('intent_failure');
 expect(inspector.prepare('SELECT COUNT(*) n FROM verification_blob_reservations').get()).toEqual({n:0});
 }finally{inspector.close();exporter.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('rejects an outer budget transaction before starting even the archive read',async()=>{
 const {createArtifactExporter}=await import('../../../src/runtime/isolated-execution/artifact-export.js');
 const {createPrimitiveBlobAuthority}=await import('../../support/primitive-blob-authority.js');
 const {openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');
 const root=mkdtempSync(join(tmpdir(),'artifact-outer-')),database=openPrivateVerificationDatabase(root),readArchive=vi.fn(async()=>Buffer.alloc(0));
 const budget=createPrimitiveBlobAuthority({database,authorityId:'artifact-export',assertCurrent(){},deletion:{assertDeleted:()=>{}}}).budget;
 const exporter=createArtifactExporter({root,database,budget,assertCurrent:()=>{},quiescence:{assertQuiescent:()=>{}},readArchive,access:{assertExport:()=>{},assertRead:()=>{},assertDelete:()=>{}}});
 try{
  let attempt!:ReturnType<typeof exporter.exportArtifacts>;
  expect(()=>database.transaction(()=>{attempt=exporter.exportArtifacts({requestSource:'agent',ownerKey:'owner',output:{},expected:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'e',scopeDigest:'a'.repeat(64)},receipt:{} as never,paths:['a']});throw Error('rollback');})()).toThrow('rollback');
  await expect(attempt).rejects.toThrow(/outer_transaction/);expect(readArchive).not.toHaveBeenCalled();
 }finally{exporter.close();budget.close();database.close();rmSync(root,{recursive:true,force:true});}
});
it('rejects a budget from another real connection before opening the export directory and leaves borrowed DB open on close',async()=>{const {createArtifactExporter}=await import('../../../src/runtime/isolated-execution/artifact-export.js'),{createPrimitiveBlobAuthority}=await import('../../support/primitive-blob-authority.js'),{openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');const root=mkdtempSync(join(tmpdir(),'artifact-db-')),a=openPrivateVerificationDatabase(join(root,'a')),b=openPrivateVerificationDatabase(join(root,'b')),budget=createPrimitiveBlobAuthority({database:a,authorityId:'artifact-export-db',assertCurrent(){},deletion:{assertDeleted(){}}}).budget,base={root:join(root,'export'),database:b,budget,assertCurrent(){},quiescence:{assertQuiescent(){}},async readArchive(){throw Error('unused');},access:{assertExport(){},assertRead(){},assertDelete(){}}};try{expect(()=>createArtifactExporter(base as any)).toThrow('database');const exporter=createArtifactExporter({...base,database:a} as any);exporter.close();expect(a.open).toBe(true);}finally{budget.close();a.close();b.close();rmSync(root,{recursive:true,force:true});}});
