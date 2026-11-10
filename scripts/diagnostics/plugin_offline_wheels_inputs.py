"""Reassemble the one frozen diagnostic inventory; no caller paths or discovery."""
import hashlib
import json
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PARTS = ('files-01.json', 'files-02.json', 'files-03.json', 'files-04.json', 'files-05.json', 'files-06.json', 'files-07.json', 'files-08.json')
_CANONICAL_SHA256 = '136442469d106b5ce13c792c8e584ef39770f431d950676e88655595e97e72ad'


def load_pins():
    pins = json.loads((_HERE / 'plugin-offline-wheels-inputs.json').read_text(encoding='utf-8'))
    if 'files' in pins:
        raise ValueError('frozen_inventory_duplicate_files')
    rows = []
    for name in _PARTS:
        part = json.loads((_HERE / 'plugin-offline-wheels-inputs' / name).read_text(encoding='utf-8'))
        if not isinstance(part, list):
            raise ValueError('frozen_inventory_part_shape')
        rows.extend(part)
    pins['files'] = rows
    canonical = json.dumps(pins, sort_keys=True, separators=(',', ':')).encode('utf-8')
    if len(rows) != 533 or hashlib.sha256(canonical).hexdigest() != _CANONICAL_SHA256:
        raise ValueError('frozen_inventory_digest_mismatch')
    return pins
