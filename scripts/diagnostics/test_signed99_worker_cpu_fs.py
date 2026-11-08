import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('worker_cpu_fs',Path(__file__).with_name('signed99-worker-cpu.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CaptureFileControls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='signed99-fs-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
 def denied_without_open(self,path,kind,reason):
  checks=[]
  with patch.object(m.os,'open',side_effect=AssertionError('rejected content opened')) as opened:
   with self.assertRaises(m.CaptureRejected) as failure:m.read_regular(path,m.CAPTURE_LIMITS[kind],kind,checks)
  self.assertEqual(failure.exception.reason,reason);opened.assert_not_called();self.assertEqual(checks[0]['kind'],kind);self.assertEqual(checks[0]['reason'],reason);self.assertEqual(checks[0]['declaredLimit'],m.CAPTURE_LIMITS[kind]);return checks
 def test_positive_all_original_caps_and_nofollow(self):
  original=m.os.open
  for kind,limit in m.CAPTURE_LIMITS.items():
   p=self.root/kind;p.write_bytes(b'fixture');checks=[];flags=[]
   def capture(path,value):flags.append(value);return original(path,value)
   with patch.object(m.os,'open',side_effect=capture):data,s=m.read_regular(p,limit,kind,checks)
   self.assertEqual(data,b'fixture');self.assertEqual(checks[0]['reason'],'accepted');self.assertTrue(flags[0]&os.O_NOFOLLOW)
 def test_empty(self):
  p=self.root/'empty';p.touch();checks=self.denied_without_open(p,'raw','empty_file');self.assertEqual(checks[0]['size'],0)
 def test_symlink(self):
  target=self.root/'secret-content';target.write_bytes(b'MUST_NOT_READ');link=self.root/'link';link.symlink_to(target);self.denied_without_open(link,'profile','not_regular')
 def test_hardlink(self):
  p=self.root/'one';p.write_bytes(b'MUST_NOT_READ');other=self.root/'two';os.link(p,other);checks=self.denied_without_open(p,'report','nlink_not_one');self.assertEqual(checks[0]['nlink'],2)
 def test_sparse_oversize_original_cap(self):
  p=self.root/'oversize'
  with p.open('wb') as f:f.truncate(m.PROFILE_LIMIT+1)
  checks=self.denied_without_open(p,'profile','size_exceeds_declared_limit');self.assertEqual(checks[0]['size'],m.PROFILE_LIMIT+1);self.assertEqual(m.PROFILE_LIMIT,128*1024**2)
 def test_uid_mismatch(self):
  p=self.root/'owned';p.write_bytes(b'MUST_NOT_READ');s=p.lstat();fake=SimpleNamespace(st_mode=s.st_mode,st_uid=s.st_uid+1,st_nlink=s.st_nlink,st_size=s.st_size)
  with patch.object(m.os,'lstat',return_value=fake):self.denied_without_open(p,'raw','uid_mismatch')
 def test_stability_still_required(self):
  p=self.root/'stable';p.write_bytes(b'fixture');before=p.lstat();attrs=['st_mode','st_uid','st_nlink','st_size','st_dev','st_ino','st_mtime_ns','st_ctime_ns'];fake=SimpleNamespace(**{k:getattr(before,k) for k in attrs});fake.st_mtime_ns+=1;checks=[]
  with patch.object(m.os,'lstat',side_effect=[before,fake]):
   with self.assertRaises(m.CaptureRejected) as failure:m.read_regular(p,m.RAW_LIMIT,'raw',checks)
  self.assertEqual(failure.exception.reason,'file_changed_during_capture')
 def test_metadata_safe_failed_content_never_read_or_copied(self):
  p=self.root/'empty';p.touch();checks=self.denied_without_open(p,'profile','empty_file');proc={'captureChecks':checks,'argv':['DO_NOT_COPY_SECRET'],'path':'DO_NOT_COPY_SECRET','groupGone':True,'rawVitestExit':1};validation={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':['DO_NOT_COPY_SECRET']}
  with patch.object(m.os,'open',side_effect=AssertionError('metadata read a file')),patch.object(Path,'read_bytes',side_effect=AssertionError('metadata read content')):
   a,b=m.control_metadata(proc,validation);self.assertTrue(m.validate_control_metadata(a,b));wire=json.dumps([a,b])
  self.assertNotIn('DO_NOT_COPY_SECRET',wire);self.assertNotIn('argv',a);self.assertFalse(b['artifactPrivacySafe']);self.assertFalse(b['diagnosticQualified']);self.assertIn('unclassified_validation_failure',b['problems'])
 def test_schema_rejects_extra_keys_and_cannot_qualify_unknown_cleanup(self):
  a,b=m.control_metadata({},{});a['path']='NO';self.assertRaises(ValueError,m.validate_control_metadata,a,b)
  self.assertRaises(ValueError,m.control_metadata,{'rawVitestExit':1,'groupGone':False},{'diagnosticQualified':True,'problems':[]})
 def test_caps_unchanged_and_no_wrong_limit(self):
  self.assertEqual(m.CAPTURE_LIMITS,{'profile':128*1024**2,'raw':8*1024**2,'report':4*1024**2});self.assertEqual(m.DIAGNOSTIC_WALL_SECONDS,38*60)
  self.assertRaises(m.CaptureRejected,m.read_regular,self.root/'absent',m.RAW_LIMIT+1,'raw',[])

class R4ControlEvidence(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='signed99-r4-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
 def catalog(self):
  return {'tests/runtime/verification/intent-publication-dependencies.test.ts':{'absolute':str(self.root/'tests/runtime/verification/intent-publication-dependencies.test.ts'),'lineCount':30,'sha256':'0'*64}}
 def report(self,error='UNKNOWN_SECRET'):
  catalog=self.catalog();file=next(iter(catalog));title=m.TITLE;oracle=((file,title,1),);rows=[{'fullName':title,'status':'failed','failureMessages':['Error: '+error+'\n at SECRET_FUNCTION ('+catalog[file]['absolute']+':7:3)\n at SECRET_FUNCTION (/foreign/SECRET:3:2)\n at SECRET_FUNCTION ('+catalog[file]['absolute']+':999:1)']}]
  return json.dumps({'numTotalTests':1,'numPendingTests':0,'numFailedTests':1,'numPassedTests':0,'numTodoTests':0,'testResults':[{'name':catalog[file]['absolute'],'assertionResults':rows}]}).encode(),catalog,oracle
 def test_fixed_producer_codes_never_generic_and_arbitrary_errors_never_echo(self):
  for code in m.PRODUCER_REASONS:self.assertEqual(m.producer_reason(m.ProducerRejected(code)),code)
  self.assertEqual(m.producer_reason(RuntimeError('SECRET_PATH_OR_TOKEN')),'producer_exception')
 def test_owned_private_directory_empty_identity_and_profile_inventory(self):
  p=self.root/'owned';p.mkdir(mode=0o700);identity=m.private_directory(p,empty=True);before=m.profile_inventory(p,'before');self.assertEqual(len(before),3);self.assertTrue(all(v['exists']is False for v in before));(p/m.PROFILE_NAMES[1]).write_bytes(b'NOT_READ')
  with patch.object(Path,'read_bytes',side_effect=AssertionError('inventory read content')):after=m.profile_inventory(p,'after')
  self.assertTrue(after[1]['exists']);self.assertEqual(after[1]['size'],8);self.assertEqual(m.private_directory(p,identity).st_ino,identity.st_ino);self.assertRaises(m.ProducerRejected,m.private_directory,p,None,True)
 def test_directory_symlink_rejected_without_read(self):
  p=self.root/'owned';p.mkdir(mode=0o700);link=self.root/'link';link.symlink_to(p);self.assertRaises(m.ProducerRejected,m.private_directory,link)
 def test_report_unknown_private_message_and_foreign_out_of_range_stack_never_upload(self):
  report,catalog,oracle=self.report();v=m.case_observation(None,report,catalog,frozenset({'explicit_profile_stopped_after_three_actual_publications'}),oracle,m.TITLE);wire=json.dumps(v);self.assertEqual(v['selectedFailureCategory'],'unknown');self.assertEqual(v['stackLocations'],[{'path':next(iter(catalog)),'line':7}]);self.assertNotIn('UNKNOWN_SECRET',wire);self.assertNotIn('SECRET_FUNCTION',wire);self.assertNotIn('/foreign',wire);self.assertEqual(v['assertionCount'],1)
 def test_literal_error_and_three_location_limit(self):
  report,catalog,oracle=self.report('explicit_profile_stopped_after_three_actual_publications');v=m.case_observation(None,report,catalog,m.CASE_ERROR_LITERALS,oracle,m.TITLE);self.assertEqual(v['selectedFailureCategory'],'explicit_profile_stopped_after_three_actual_publications');self.assertLessEqual(len(v['stackLocations']),3)
 def test_independent_raw_report_capture_not_profile_requirement(self):
  report,catalog,oracle=self.report();raw=b'population-publication-ms 0 1\npopulation-publication-ms 1 2\npopulation-publication-ms 2 3\n';v=m.case_observation(raw,report,catalog,frozenset(),oracle,m.TITLE);self.assertTrue(v['rawThreePublications']);self.assertTrue(v['reportAvailable']);self.assertTrue(v['rawAvailable'])
 def test_metadata_rejects_forged_location_or_unknown_extra_key(self):
  report,catalog,oracle=self.report();v=m.case_observation(None,report,catalog,frozenset(),oracle,m.TITLE);proc={'caseObservation':v};a,b=m.control_metadata(proc,{},catalog);self.assertTrue(m.validate_control_metadata(a,b,catalog));a['caseObservation']['stackLocations'][0]['line']=31;self.assertRaises(ValueError,m.validate_control_metadata,a,b,catalog)
 def test_source_catalog_before_hash_and_unknown_source_cannot_enter(self):
  p=self.root/'test.ts';p.write_text("throw Error('verification_capacity_exhausted');\n");before={'test.ts':m.sha(p.read_bytes())};catalog,literals=m.source_catalog(self.root,before);self.assertEqual(catalog['test.ts']['lineCount'],2);self.assertIn('verification_capacity_exhausted',literals);p.write_text('changed');self.assertRaises(m.ProducerRejected,m.source_catalog,self.root,before)


class R4FinalDirectoryQualification(unittest.TestCase):
 def qualified(self):
  proc={k:True for k in ['actualWait','leaderReaped','stdioClosed','groupGone','profileDirectoryVerified']};proc.update(profileInventory=[],auxCaptureProblems=[])
  validation={'diagnosticQualified':True,'artifactPrivacySafe':True,'problems':[],'signed99WholePass':False}
  return proc,validation
 def test_real_final_recheck_failure_revokes_upload_and_exit(self):
  proc,validation=self.qualified();self.assertEqual(m.qualification_outcome(validation,proc),(True,0));identity=object();directory=Path('/never-opened')
  with patch.object(m,'private_directory',side_effect=m.ProducerRejected('profile_directory_changed')) as check,patch.object(m,'profile_inventory',side_effect=AssertionError('must not inspect rejected directory')) as inventory:
   revoked=m.final_profile_directory_recheck(directory,identity,proc,validation)
  check.assert_called_once_with(directory,identity);inventory.assert_not_called();self.assertFalse(revoked['diagnosticQualified']);self.assertFalse(revoked['artifactPrivacySafe']);self.assertFalse(proc['profileDirectoryVerified']);self.assertIn('profile_directory_changed',revoked['problems']);self.assertIn('profile_directory_changed',proc['auxCaptureProblems']);self.assertEqual(m.qualification_outcome(revoked,proc),(False,2));self.assertTrue(validation['diagnosticQualified'])
 def test_unknown_final_exception_is_fixed_and_fail_closed(self):
  proc,validation=self.qualified()
  with patch.object(m,'private_directory',side_effect=RuntimeError('SECRET_PATH_OR_TOKEN')):
   revoked=m.final_profile_directory_recheck(Path('/never-opened'),object(),proc,validation)
  self.assertEqual(m.qualification_outcome(revoked,proc),(False,2));self.assertEqual(revoked['problems'],['producer_exception']);self.assertNotIn('SECRET_PATH_OR_TOKEN',json.dumps([revoked,proc]))
 def test_pure_revocation_preserves_prior_rejection(self):
  original={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':['unexpected_secondary_profile']};revoked=m.invalidate_qualification(original,'profile_directory_changed');self.assertEqual(original['problems'],['unexpected_secondary_profile']);self.assertEqual(revoked['problems'],['unexpected_secondary_profile','profile_directory_changed']);self.assertFalse(revoked['diagnosticQualified']);self.assertFalse(revoked['artifactPrivacySafe'])

if __name__=='__main__':unittest.main()
