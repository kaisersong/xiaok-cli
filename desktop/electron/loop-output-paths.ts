import { basename } from 'node:path';

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com0',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt0',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function isSafeLoopOutputFileName(fileName: string): boolean {
  if (!fileName) return false;
  const normalized = fileName.normalize('NFC');
  if (normalized === '.' || normalized === '..') return false;
  if (normalized.includes('/') || normalized.includes('\\')) return false;
  if (normalized.includes(':')) return false;
  if (normalized.endsWith('.') || normalized.endsWith(' ')) return false;
  if (basename(normalized) !== normalized) return false;

  const stem = normalized.split('.')[0]?.toLowerCase();
  if (!stem || WINDOWS_RESERVED_DEVICE_NAMES.has(stem)) return false;

  return true;
}
