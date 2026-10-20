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
if __name__=='__main__':unittest.main()
