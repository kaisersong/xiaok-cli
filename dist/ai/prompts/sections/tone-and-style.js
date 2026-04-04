/**
 * Layer 6: Tone and interaction style.
 * English.
 */
export function getToneAndStyleSection() {
    return [
        '# Tone and style',
        '- Only use emojis if the user explicitly requests it.',
        '- Your responses should be short and concise.',
        '- When referencing specific functions or pieces of code include the pattern file_path:line_number.',
        '- Do not use a colon before tool calls.',
        '- Unless the user explicitly asks for execution details, do not show internal tool activity logs. Use 1-2 natural language sentences to describe what you are doing and why.',
    ].join('\n');
}
