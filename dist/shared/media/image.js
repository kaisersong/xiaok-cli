export function detectImageMediaType(data) {
    if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a)
        return 'image/png';
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8)
        return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)))
        return 'image/gif';
    if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
        return 'image/webp';
    return null;
}
export function readImageDimensions(data) {
    return readPngDimensions(data)
        ?? readJpegDimensions(data)
        ?? readGifDimensions(data)
        ?? readWebpDimensions(data);
}
function readPngDimensions(data) {
    if (data.length < 24)
        return null;
    if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a)
        return null;
    if (data.toString('ascii', 12, 16) !== 'IHDR')
        return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function readJpegDimensions(data) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8)
        return null;
    let offset = 2;
    while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = data[offset + 1];
        const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame) {
            return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
        }
        const segmentLength = data.readUInt16BE(offset + 2);
        if (segmentLength < 2)
            return null;
        offset += 2 + segmentLength;
    }
    return null;
}
function readGifDimensions(data) {
    if (data.length < 10)
        return null;
    const signature = data.toString('ascii', 0, 6);
    if (signature !== 'GIF87a' && signature !== 'GIF89a')
        return null;
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}
function readWebpDimensions(data) {
    if (data.length < 25)
        return null;
    if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP')
        return null;
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
        if (data.length < 30)
            return null;
        return {
            width: data.readUIntLE(24, 3) + 1,
            height: data.readUIntLE(27, 3) + 1,
        };
    }
    if (chunk === 'VP8 ') {
        if (data.length < 30)
            return null;
        if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a)
            return null;
        return {
            width: data.readUInt16LE(26) & 0x3fff,
            height: data.readUInt16LE(28) & 0x3fff,
        };
    }
    if (chunk === 'VP8L' && data[20] === 0x2f) {
        const bits = data.readUInt32LE(21);
        if (bits >>> 29 !== 0)
            return null;
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
}
export function readImageMetadata(data) {
    const formats = [
        ['image/png', readPngDimensions], ['image/jpeg', readJpegDimensions],
        ['image/gif', readGifDimensions], ['image/webp', readWebpDimensions],
    ];
    for (const [mediaType, read] of formats) {
        const dims = read(data);
        if (dims && dims.width > 0 && dims.height > 0)
            return { ...dims, mediaType };
    }
    return null;
}
