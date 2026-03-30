export function formatPrintOutput(result, asJson) {
    if (asJson) {
        return JSON.stringify(result, null, 2);
    }
    return result.text;
}
