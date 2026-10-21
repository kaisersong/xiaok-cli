export function capturedSqliteEncoding(value) {
    if (value !== 'UTF-8' && value !== 'UTF-16le' && value !== 'UTF-16be')
        throw Error('source_sqlite_encoding');
    return value;
}
export function encodeCapturedSqliteCell(type, value, textBytes, encoding) {
    let result;
    if (type === 'null' && value === null)
        result = { type: 'null' };
    else if (type === 'integer' && typeof value === 'bigint')
        result = { type: 'integer', value: String(value) };
    else if (type === 'real' && typeof value === 'number' && !Number.isNaN(value)) {
        const bytes = Buffer.alloc(8);
        bytes.writeDoubleBE(value);
        result = { type: 'real', value: bytes.toString('hex') };
    }
    else if (type === 'blob' && Buffer.isBuffer(value))
        result = { type: 'blob', value: value.toString('base64') };
    else if (type === 'text' && Buffer.isBuffer(textBytes)) {
        const decoded = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(textBytes);
        const encoded = Buffer.from(decoded, encoding === 'UTF-8' ? 'utf8' : 'utf16le');
        if (encoding === 'UTF-16be')
            encoded.swap16();
        if (!encoded.equals(textBytes))
            throw Error('source_sqlite_text_encoding');
        result = { type: 'text', value: decoded };
    }
    else
        throw Error('source_sqlite_storage_class');
    return Object.freeze(result);
}
