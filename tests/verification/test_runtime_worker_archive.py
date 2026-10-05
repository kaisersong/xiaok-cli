import hashlib, importlib.util, io, json, pathlib, tarfile, tempfile, unittest
MODULE = pathlib.Path(__file__).resolve().parents[2] / 'scripts/verification/prepare-macos-runtime.py'
spec = importlib.util.spec_from_file_location('runtime_prepare', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class WorkerArchive(unittest.TestCase):
    def test_real_tar_content_and_config_binding(self):
        config = json.dumps({'architecture':'arm64','os':'linux','config':{'User':''}}).encode()
        image = hashlib.sha256(config).hexdigest()
        layer = b'actual frozen layer bytes'
        layerhash = hashlib.sha256(layer).hexdigest()
        manifest = json.dumps([{'Config':'blobs/sha256/'+image,'Layers':['blobs/sha256/'+layerhash]}]).encode()
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)/'worker.tar'
            with tarfile.open(path,'w') as archive:
                for name,body in [('manifest.json',manifest),('blobs/sha256/'+image,config),('blobs/sha256/'+layerhash,layer)]:
                    info=tarfile.TarInfo(name);info.size=len(body);archive.addfile(info,io.BytesIO(body))
            module.validate_worker_archive(path, 'sha256:'+image)
            with self.assertRaisesRegex(ValueError,'worker image identity'):
                module.validate_worker_archive(path,'sha256:'+'f'*64)
            with tarfile.open(path,'a') as archive:
                info=tarfile.TarInfo('blobs/sha256/'+layerhash);info.size=1;archive.addfile(info,io.BytesIO(b'x'))
            with self.assertRaisesRegex(ValueError,'duplicate'):
                module.validate_worker_archive(path,'sha256:'+image)
if __name__=='__main__':unittest.main()
