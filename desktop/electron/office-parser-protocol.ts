import type { OfficeFormat } from '../../src/runtime/materials/document-formats.js';

export const OFFICE_PARSER_PROTOCOL_VERSION = 1 as const;
export const ANYDOC_ENGINE_VERSION = '0.1.8' as const;

export type OfficeParserErrorCode =
  | 'unsupported_format'
  | 'binding_unavailable'
  | 'encrypted_document'
  | 'malformed_document'
  | 'resource_limit'
  | 'missing_part'
  | 'io_error'
  | 'timeout'
  | 'aborted'
  | 'worker_start_failed'
  | 'worker_crashed'
  | 'protocol_error'
  | 'empty_output';

export interface OfficeParserRequestV1 {
  protocolVersion: typeof OFFICE_PARSER_PROTOCOL_VERSION;
  absolutePath: string;
  format: OfficeFormat;
  maxOutputChars: number;
}

export interface OfficeParserSuccessV1 {
  protocolVersion: typeof OFFICE_PARSER_PROTOCOL_VERSION;
  ok: true;
  markdown: string;
  format: OfficeFormat;
  engine: 'anydoc';
  engineVersion: typeof ANYDOC_ENGINE_VERSION;
  chars: number;
  truncated: boolean;
}

export interface OfficeParserFailureV1 {
  protocolVersion: typeof OFFICE_PARSER_PROTOCOL_VERSION;
  ok: false;
  code: OfficeParserErrorCode;
  message: string;
  retryable: boolean;
}

export type OfficeParserResponseV1 = OfficeParserSuccessV1 | OfficeParserFailureV1;

export type OfficeParseResult =
  | Omit<OfficeParserSuccessV1, 'protocolVersion'>
  | Omit<OfficeParserFailureV1, 'protocolVersion'>;

const ERROR_CODES: ReadonlySet<OfficeParserErrorCode> = new Set([
  'unsupported_format',
  'binding_unavailable',
  'encrypted_document',
  'malformed_document',
  'resource_limit',
  'missing_part',
  'io_error',
  'timeout',
  'aborted',
  'worker_start_failed',
  'worker_crashed',
  'protocol_error',
  'empty_output',
]);

export function parseOfficeParserResponse(value: unknown): OfficeParserResponseV1 | undefined {
  if (!isRecord(value) || value.protocolVersion !== OFFICE_PARSER_PROTOCOL_VERSION || typeof value.ok !== 'boolean') {
    return undefined;
  }
  if (value.ok) {
    if (
      typeof value.markdown !== 'string'
      || typeof value.format !== 'string'
      || value.engine !== 'anydoc'
      || value.engineVersion !== ANYDOC_ENGINE_VERSION
      || typeof value.chars !== 'number'
      || !Number.isSafeInteger(value.chars)
      || typeof value.truncated !== 'boolean'
    ) {
      return undefined;
    }
    return value as unknown as OfficeParserSuccessV1;
  }
  if (
    typeof value.code !== 'string'
    || !ERROR_CODES.has(value.code as OfficeParserErrorCode)
    || typeof value.message !== 'string'
    || typeof value.retryable !== 'boolean'
  ) {
    return undefined;
  }
  return value as unknown as OfficeParserFailureV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
