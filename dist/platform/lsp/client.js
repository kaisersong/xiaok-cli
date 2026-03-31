export function encodeLspMessage(message) {
    const payload = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
export function decodeLspFrames(input) {
    const messages = [];
    let rest = input;
    while (rest.length > 0) {
        const headerEnd = rest.indexOf('\r\n\r\n');
        if (headerEnd === -1)
            break;
        const header = rest.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match)
            break;
        const length = Number(match[1]);
        const payloadStart = headerEnd + 4;
        const payload = rest.slice(payloadStart, payloadStart + length);
        messages.push(JSON.parse(payload));
        rest = rest.slice(payloadStart + length);
    }
    return messages;
}
