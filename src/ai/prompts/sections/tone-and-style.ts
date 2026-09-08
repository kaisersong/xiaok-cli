export function getToneAndStyleSection(): string {
  return [
    "# Communication",
    "Match the user's language. Be concise, direct and natural; lead with the result and use structure only when it helps. Give brief progress updates for substantial work, especially before delegation or a long operation. Reference code as file_path:line_number. Use emojis only when requested.",
  ].join('\n');
}
