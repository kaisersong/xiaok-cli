import hashlib,json,os,pathlib,platform,select,signal,subprocess,tempfile,unittest,uuid,sys
binary='/helper/artifact-export-helper'
assert hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()==sys.argv[1]
print(json.dumps({'platform':platform.platform(),'machine':platform.machine(),'helperSha256':sys.argv[1]}),flush=True)
sys.argv=sys.argv[:1]
class ExportTests(unittest.TestCase):
 def setUp(self):
  self.work=tempfile.TemporaryDirectory(prefix='xiaok-export-linux-');self.parent=pathlib.Path(self.work.name);self.children=[]
 def tearDown(self):
  for p in self.children:
   if p.poll() is None:p.kill()
   p.wait(timeout=5)
   for stream in [p.stdin,p.stdout,p.stderr]:
    stream.close()
  self.work.cleanup()
 def launch(self,data=b'original',target='result.bin',digest=None,parent=None):
  parent=parent or self.parent;st=parent.stat();temp='.xiaok-export-'+str(uuid.uuid4());token=os.urandom(32).hex()
  p=subprocess.Popen([binary,str(parent),temp,target,str(len(data)),digest or hashlib.sha256(data).hexdigest(),str(st.st_dev),str(st.st_ino),token],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={});self.children.append(p);p.export_facts=(str(parent),temp,str(len(data)),digest or hashlib.sha256(data).hexdigest(),str(st.st_dev),str(st.st_ino),token)
  return p,temp
 def read(self,p,stage):
  if not select.select([p.stdout],[],[],8)[0]:self.fail('timeout '+stage)
  value=json.loads(p.stdout.readline());self.assertEqual(value['stage'],stage);return value
 def stage(self,p,data=b'original'):
  self.read(p,'ready');p.stdin.write(b'C');p.stdin.flush();self.read(p,'created');p.stdin.write(b'W'+data);p.stdin.flush();return self.read(p,'staged')
 def finish(self,p,command=b''):
  out,err=p.communicate(command,timeout=10);value=json.loads(out.splitlines()[-1]);self.assertEqual(value['stage'],'finished');return value
 def test_empty_and_16MiB(self):
  for size in [0,16*1024**2]:
   with self.subTest(size=size):
    data=b'a'*size;target='result'+str(size);p,temp=self.launch(data,target);self.stage(p,data);v=self.finish(p,b'K');self.assertTrue(v['ok']);self.assertTrue(v['committed']);self.assertEqual(v['cleanup'],'removed');self.assertEqual((self.parent/target).read_bytes(),data);self.assertFalse((self.parent/temp).exists())
 def test_existing_destination(self):
  (self.parent/'result.bin').write_bytes(b'keep');p,temp=self.launch();self.stage(p);v=self.finish(p,b'K');self.assertFalse(v['committed']);self.assertEqual((self.parent/'result.bin').read_bytes(),b'keep')
 def test_no_create(self):
  p,temp=self.launch();self.read(p,'ready');v=self.finish(p);self.assertEqual(v['cleanup'],'none');self.assertFalse((self.parent/temp).exists())
 def test_no_write(self):
  p,temp=self.launch();self.read(p,'ready');p.stdin.write(b'C');p.stdin.flush();self.read(p,'created');v=self.finish(p);self.assertEqual(v['cleanup'],'removed');self.assertFalse((self.parent/temp).exists())
 def test_wrong_hash(self):
  p,temp=self.launch(digest='0'*64);self.read(p,'ready');p.stdin.write(b'C');p.stdin.flush();self.read(p,'created');v=self.finish(p,b'Woriginal');self.assertFalse(v['committed']);self.assertEqual(v['cleanup'],'removed')
 def test_parent_rename(self):
  old=self.parent/'child';old.mkdir();new=self.parent/'moved';p,temp=self.launch(parent=old);self.stage(p);old.rename(new);v=self.finish(p);self.assertEqual(v['cleanup'],'removed');self.assertFalse((new/temp).exists())
 def test_temp_replaced(self):
  p,temp=self.launch();self.stage(p);(self.parent/temp).rename(self.parent/'moved');(self.parent/temp).write_bytes(b'foreign');v=self.finish(p,b'K');self.assertEqual(v['cleanup'],'unknown');self.assertEqual((self.parent/temp).read_bytes(),b'foreign');self.assertFalse((self.parent/'result.bin').exists())
 def test_cancel(self):
  p,temp=self.launch();self.stage(p);p.send_signal(signal.SIGTERM);v=self.read(p,'finished');p.wait(timeout=5);self.assertEqual(v['cleanup'],'removed');self.assertFalse((self.parent/temp).exists())
 def test_kill(self):
  p,temp=self.launch();self.stage(p);p.kill();out,_=p.communicate(timeout=5);self.assertEqual(out,b'');self.assertEqual((self.parent/temp).read_bytes()[:8],b'original');self.assertFalse((self.parent/'result.bin').exists())
 def test_symlink_parent(self):
  actual=self.parent/'actual';actual.mkdir();link=self.parent/'link';link.symlink_to(actual,target_is_directory=True);p,temp=self.launch(parent=link);v=self.finish(p);self.assertFalse(v['ok']);self.assertFalse((actual/temp).exists())
 def test_posix_names(self):
  for name in ['report:final.md','CON','result.','back\\slash']:
   with self.subTest(name=name):
    p,temp=self.launch(target=name);self.stage(p);v=self.finish(p,b'K');self.assertTrue(v['ok']);self.assertEqual((self.parent/name).read_bytes(),b'original')
 def test_extra_commit(self):
  p,temp=self.launch();self.stage(p);v=self.finish(p,b'KK');self.assertFalse(v['ok']);self.assertFalse((self.parent/'result.bin').exists())
 def recover(self,p,identity,phase='staged',token=None):
  parent,temp,size,digest,dev,ino,original=p.export_facts
  result=subprocess.run([binary,'--recover',parent,temp,size,digest,dev,ino,identity['device'],identity['inode'],token or original,phase],input=b'',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env={})
  self.assertEqual(len(result.stdout.splitlines()),1);value=json.loads(result.stdout);self.assertEqual(value['stage'],'recovered');return result.returncode,value
 def test_recover_live_lock(self):
  p,temp=self.launch();staged=self.stage(p);code,value=self.recover(p,staged['identity']);self.assertNotEqual(code,0);self.assertEqual(value['error'],'file_lock');self.assertTrue((self.parent/temp).exists());self.finish(p)
 def test_recover_killed(self):
  p,temp=self.launch();staged=self.stage(p);p.kill();p.communicate(timeout=5);code,value=self.recover(p,staged['identity']);self.assertEqual(code,0);self.assertEqual(value['cleanup'],'removed');self.assertFalse((self.parent/temp).exists());self.assertFalse((self.parent/'result.bin').exists())
 def test_recover_wrong_token(self):
  p,temp=self.launch();staged=self.stage(p);p.kill();p.communicate(timeout=5);code,value=self.recover(p,staged['identity'],token='0'*64);self.assertNotEqual(code,0);self.assertEqual(value['cleanup'],'unknown');self.assertTrue((self.parent/temp).exists())
 def test_recover_created(self):
  p,temp=self.launch();self.read(p,'ready');p.stdin.write(b'C');p.stdin.flush();created=self.read(p,'created');p.kill();p.communicate(timeout=5);code,value=self.recover(p,created['identity'],'created');self.assertEqual(code,0);self.assertEqual(value['cleanup'],'removed')
 def test_hardlinked_before_commit(self):
  p,temp=self.launch();self.stage(p);target=self.parent/'result.bin';os.link(self.parent/temp,target);before=target.read_bytes();v=self.finish(p,b'K');self.assertFalse(v['committed']);self.assertEqual(target.read_bytes(),before)
 def test_recover_missing(self):
  p,temp=self.launch();staged=self.stage(p);p.kill();p.communicate(timeout=5);(self.parent/temp).unlink();code,value=self.recover(p,staged['identity']);self.assertNotEqual(code,0);self.assertEqual(value['cleanup'],'unknown')
unittest.main(verbosity=2)
