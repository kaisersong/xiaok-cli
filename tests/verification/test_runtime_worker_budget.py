import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'scripts/verification/prepare-macos-runtime.py'
spec = importlib.util.spec_from_file_location('runtime_budget_prepare', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorkerBudget(unittest.TestCase):
    def archive(self, root, size, mismatch=False):
        layer = root / 'raw-layer'
        with layer.open('wb') as stream:
            stream.truncate(size)
        with layer.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        config = json.dumps({'architecture': 'arm64', 'os': 'linux',
                             'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + ('f' * 64 if mismatch else digest)]}}).encode()
        image = hashlib.sha256(config).hexdigest()
        manifest = json.dumps([{'Config': 'blobs/sha256/' + image, 'Layers': ['blobs/sha256/' + digest]}]).encode()
        path = root / 'worker.tar'
        with tarfile.open(path, 'w') as archive:
            for name, body in [('manifest.json', manifest), ('blobs/sha256/' + image, config)]:
                member = tarfile.TarInfo(name)
                member.size = len(body)
                archive.addfile(member, io.BytesIO(body))
            member = tarfile.TarInfo('blobs/sha256/' + digest)
            member.size = size
            with layer.open('rb') as stream:
                archive.addfile(member, stream)
        return path, 'sha256:' + image

    def test_actual_layer_above_old_budget_is_validated(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.archive(pathlib.Path(folder), 129 * 1024**2)
            module.validate_worker_archive(path, image)

    def test_declared_over_new_budget_refuses_before_extracting(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'too-large.tar'
            member = tarfile.TarInfo('declared-large-layer')
            member.size = 256 * 1024**2 + 1
            path.write_bytes(member.tobuf() + bytes(1024))
            with patch.object(tarfile.TarFile, 'extractfile', side_effect=AssertionError('must not read payload')):
                with self.assertRaisesRegex(ValueError, 'worker archive budget'):
                    module.validate_worker_archive(path, 'sha256:' + 'a' * 64)

    def test_config_diff_id_must_match_original_raw_layer(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.archive(pathlib.Path(folder), 4096, mismatch=True)
            with self.assertRaisesRegex(ValueError, 'worker image rootfs'):
                module.validate_worker_archive(path, image)

    def test_truncated_layer_is_never_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.archive(pathlib.Path(folder), 4096)
            with path.open('r+b') as stream:
                stream.truncate(3073)
            with self.assertRaises((ValueError, tarfile.ReadError, EOFError)):
                module.validate_worker_archive(path, image)


if __name__ == '__main__':
    unittest.main()
