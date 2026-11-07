import importlib.util
import os
import pathlib
import stat
import tempfile
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'scripts/verification/prepare-macos-runtime.py'
spec = importlib.util.spec_from_file_location('qemu_runtime_prepare', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QemuPayload(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.prefix = self.root / 'source'
        self.output = self.root / 'output'
        self.entries = [
            'bin/qemu-system-aarch64', 'bin/qemu-img',
            'share/qemu/edk2-aarch64-code.fd', 'share/qemu/edk2-arm-vars.fd',
            'share/qemu/efi-virtio.rom',
        ]
        for name in self.entries:
            path = self.prefix / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('frozen:' + name).encode())
            path.chmod(0o755 if name.startswith('bin/') else 0o644)

    def test_copies_exact_required_binaries_firmware_and_network_rom(self):
        module.copy_qemu_payload(self.prefix, self.output)
        actual = sorted(str(path.relative_to(self.output)).replace(os.sep, '/')
                        for path in self.output.rglob('*') if path.is_file())
        self.assertEqual(actual, sorted(self.entries))
        for name in self.entries:
            self.assertEqual((self.output / name).read_bytes(), (self.prefix / name).read_bytes())
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE((self.output / name).stat().st_mode),
                                 stat.S_IMODE((self.prefix / name).stat().st_mode))

    def test_missing_rom_refuses_before_any_copy(self):
        (self.prefix / 'share/qemu/efi-virtio.rom').unlink()
        with self.assertRaisesRegex(ValueError, 'qemu runtime payload'):
            module.copy_qemu_payload(self.prefix, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipIf(os.name == 'nt', 'symlink creation needs separate Windows privilege')
    def test_source_link_refuses_without_touching_external_bytes(self):
        path = self.prefix / 'share/qemu/efi-virtio.rom'
        outside = self.root / 'outside'
        outside.write_bytes(b'outside unchanged')
        path.unlink()
        path.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'qemu runtime payload'):
            module.copy_qemu_payload(self.prefix, self.output)
        self.assertEqual(outside.read_bytes(), b'outside unchanged')
        self.assertFalse(self.output.exists())

    def test_source_directory_refuses_before_any_copy(self):
        path = self.prefix / 'share/qemu/efi-virtio.rom'
        path.unlink()
        path.mkdir()
        with self.assertRaisesRegex(ValueError, 'qemu runtime payload'):
            module.copy_qemu_payload(self.prefix, self.output)
        self.assertFalse(self.output.exists())

    def test_conflicting_destination_is_never_overwritten(self):
        path = self.output / 'bin/qemu-system-aarch64'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'other reviewed payload')
        with self.assertRaisesRegex(ValueError, 'conflicting runtime basename'):
            module.copy_qemu_payload(self.prefix, self.output)
        self.assertEqual(path.read_bytes(), b'other reviewed payload')
        self.assertFalse((self.output / 'share/qemu/efi-virtio.rom').exists())


if __name__ == '__main__':
    unittest.main()
