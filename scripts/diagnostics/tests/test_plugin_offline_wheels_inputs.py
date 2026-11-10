"""The split pins must reconstruct the exact original diagnostic inventory."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from plugin_offline_wheels_inputs import load_pins


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrozenWheelInputs(unittest.TestCase):
    def test_full_canonical_inventory_and_consumer_are_unchanged(self):
        pins = load_pins()
        canonical = json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(),
                         '136442469d106b5ce13c792c8e584ef39770f431d950676e88655595e97e72ad')
        self.assertEqual(len(pins['files']), 533)
        self.assertEqual(len({row['path'] for row in pins['files']}), 533)
        self.assertTrue(all(set(row) == {'path', 'sha256', 'size', 'mode'} for row in pins['files']))
        consumer = module_at('wheel_diagnostic_consumer', HERE / 'plugin-offline-wheels.py')
        self.assertEqual(consumer.PINS, pins)
        workflow = (HERE.parents[1] / '.github/workflows/plugin-offline-wheels.yml').read_text()
        inline = workflow.split("          @'\n", 1)[1].split("          '@ | python -", 1)[0]
        inline = '\n'.join(line[10:] if line.startswith(' ' * 10) else line for line in inline.splitlines())
        compile(inline, 'workflow-inline-diagnostic', 'exec')
        self.assertIn('from plugin_offline_wheels_inputs import load_pins', inline)
        self.assertIn('pins = load_pins()', inline)

    def test_missing_changed_or_reordered_part_is_rejected(self):
        for mutation in ('missing', 'changed', 'reordered'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory(prefix='wheel-pins-') as temp:
                root = Path(temp)
                for name in ('plugin_offline_wheels_inputs.py', 'plugin-offline-wheels-inputs.json'):
                    shutil.copyfile(HERE / name, root / name)
                shutil.copytree(HERE / 'plugin-offline-wheels-inputs', root / 'plugin-offline-wheels-inputs')
                part = root / 'plugin-offline-wheels-inputs/files-01.json'
                if mutation == 'missing':
                    part.unlink()
                else:
                    records = json.loads(part.read_text())
                    if mutation == 'changed':
                        records[0]['sha256'] = '0' * 64
                    else:
                        records[0], records[1] = records[1], records[0]
                    part.write_text(json.dumps(records))
                loader = module_at('wheel_inputs_' + mutation, root / 'plugin_offline_wheels_inputs.py')
                with self.assertRaises((ValueError, FileNotFoundError)):
                    loader.load_pins()


if __name__ == '__main__':
    unittest.main()
