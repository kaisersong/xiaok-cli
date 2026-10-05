/** The existing Desktop main/child model-visible result boundary, shared with eval. */
export function projectDesktopToolResultForModel(result: string): string {
  return result.slice(0, 50_000);
}
