import { fileURLToPath } from 'node:url';

interface ClipboardSource { read(format: string): string; readText(): string; readBuffer(format: string): Buffer; }

export function readClipboardPathCandidates(clipboard: ClipboardSource): string[] {
  const candidates = [
    ...readMacClipboardFilePaths(),
    ...readWindowsClipboardFilePaths(),
    ...readTextClipboardFilePaths(),
  ];
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = materialPathKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  function readMacClipboardFilePaths(): string[] {
    const paths: string[] = [];
    const nsFilenames = readClipboardFormat('NSFilenamesPboardType');
    if (nsFilenames) {
      const xmlPaths = nsFilenames.match(/<string>(.*?)<\/string>/g)
        ?.map(m => m.replace(/<\/?string>/g, ''))
        .map(decodeXmlEntities) ?? [];
      paths.push(...xmlPaths);
      if (xmlPaths.length === 0) {
        paths.push(...splitClipboardPathList(nsFilenames));
      }
    }

    const fileUrl = readClipboardFormat('public.file-url') || readClipboardFormat('text/uri-list');
    if (fileUrl) {
      paths.push(...splitClipboardPathList(fileUrl));
    }

    return paths.map(normalizeClipboardPathCandidate).filter(isLikelyFilePath);
  }

  function readWindowsClipboardFilePaths(): string[] {
    const paths: string[] = [];
    paths.push(...parseNullDelimitedPaths(readClipboardBuffer('FileNameW'), 'utf16le'));
    paths.push(...parseNullDelimitedPaths(readClipboardBuffer('FileName'), 'utf8'));
    paths.push(...parseDropFilesClipboardBuffer(readClipboardBuffer('CF_HDROP')));

    return paths.map(normalizeClipboardPathCandidate).filter(isLikelyFilePath);
  }

  function readTextClipboardFilePaths(): string[] {
    return splitClipboardPathList(readClipboardText())
      .map(normalizeClipboardPathCandidate)
      .filter(isLikelyFilePath);
  }

  function readClipboardFormat(format: string): string {
    try {
      return clipboard.read(format);
    } catch {
      return '';
    }
  }

  function readClipboardText(): string {
    try {
      return clipboard.readText();
    } catch {
      return '';
    }
  }

  function readClipboardBuffer(format: string): Buffer {
    try {
      return clipboard.readBuffer(format);
    } catch {
      return Buffer.alloc(0);
    }
  }
}

function splitClipboardPathList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap(line => {
      const trimmed = line.trim();
      return trimmed ? [trimmed] : [];
    });
}

function parseNullDelimitedPaths(buffer: Buffer, encoding: BufferEncoding): string[] {
  if (buffer.length === 0) return [];
  return buffer
    .toString(encoding)
    .split('\0')
    .map(value => value.trim())
    .filter(Boolean);
}

function parseDropFilesClipboardBuffer(buffer: Buffer): string[] {
  if (buffer.length < 20) return [];
  const fileListOffset = buffer.readUInt32LE(0);
  const isWide = buffer.readUInt32LE(16) !== 0;
  if (fileListOffset < 20 || fileListOffset >= buffer.length) return [];
  return parseNullDelimitedPaths(buffer.subarray(fileListOffset), isWide ? 'utf16le' : 'utf8');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripWrappingQuotes(value: string): string {
  let next = value.trim();
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")) ||
      (next.startsWith('`') && next.endsWith('`')))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function normalizeClipboardPathCandidate(value: string): string {
  const unquoted = stripWrappingQuotes(value);
  if (/^file:\/\//i.test(unquoted)) {
    try {
      return fileURLToPath(unquoted);
    } catch {
      return unquoted;
    }
  }
  return unquoted;
}

function isLikelyFilePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value) ||
    /^\/[^\s/]/.test(value);
}

function materialPathKey(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\');
  return /^[a-zA-Z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized)
    ? normalized.toLowerCase()
    : filePath;
}

