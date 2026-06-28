import { describe, expect, it } from 'vitest'
import { fileBasename, isAbsoluteFilePath, toFileUrl } from '../../renderer/src/lib/file-path'

describe('isAbsoluteFilePath', () => {
  it('accepts POSIX absolute paths', () => {
    expect(isAbsoluteFilePath('/Users/song/report.html')).toBe(true)
    expect(isAbsoluteFilePath('/tmp/x.md')).toBe(true)
  })

  it('accepts Windows drive-letter paths with either separator', () => {
    expect(isAbsoluteFilePath('D:\\projects\\xiaok-cli\\report.html')).toBe(true)
    expect(isAbsoluteFilePath('C:/projects/report.md')).toBe(true)
    expect(isAbsoluteFilePath('z:\\a.txt')).toBe(true)
  })

  it('accepts Windows UNC paths', () => {
    expect(isAbsoluteFilePath('\\\\server\\share\\file.html')).toBe(true)
  })

  it('rejects relative paths and empty values', () => {
    expect(isAbsoluteFilePath('report.html')).toBe(false)
    expect(isAbsoluteFilePath('artifacts/report.html')).toBe(false)
    expect(isAbsoluteFilePath('')).toBe(false)
    expect(isAbsoluteFilePath(undefined)).toBe(false)
    expect(isAbsoluteFilePath(null)).toBe(false)
  })
})

describe('fileBasename', () => {
  it('extracts the basename from POSIX paths', () => {
    expect(fileBasename('/Users/song/artifacts/report.html')).toBe('report.html')
  })

  it('extracts the basename from Windows paths', () => {
    expect(fileBasename('D:\\projects\\xiaok-cli\\desktop\\artifacts\\report-jun-2026-ai-dynamics.html'))
      .toBe('report-jun-2026-ai-dynamics.html')
  })

  it('handles mixed separators and trailing slashes', () => {
    expect(fileBasename('D:/projects\\desktop/report.md')).toBe('report.md')
    expect(fileBasename('/Users/song/dir/')).toBe('dir')
  })

  it('returns the input when there is no separator', () => {
    expect(fileBasename('report.html')).toBe('report.html')
    expect(fileBasename('')).toBe('')
    expect(fileBasename(undefined)).toBe('')
  })
})

describe('toFileUrl', () => {
  it('builds a triple-slash drive URL for Windows paths', () => {
    expect(toFileUrl('D:\\projects\\xiaok-cli\\report.html'))
      .toBe('file:///D:/projects/xiaok-cli/report.html')
  })

  it('keeps POSIX absolute paths as a standard file URL', () => {
    expect(toFileUrl('/Users/song/report.html')).toBe('file:///Users/song/report.html')
  })

  it('produces a URL the WHATWG parser accepts and round-trips the drive letter', () => {
    const url = new URL(toFileUrl('D:\\projects\\my reports\\x.html'))
    expect(url.protocol).toBe('file:')
    // main-process resolveLocalFileOpenPath relies on this `/<drive>:/` shape
    expect(/^\/[a-zA-Z]:\//.test(url.pathname)).toBe(true)
    expect(decodeURIComponent(url.pathname)).toBe('/D:/projects/my reports/x.html')
  })
})
