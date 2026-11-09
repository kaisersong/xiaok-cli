import { ContextLinkNavigation } from './navigation.js';

interface NavigationWindow { getURL(): string; loadURL(url: string): Promise<unknown> }
interface ApplicationNavigationOptions {
  argv: readonly string[];
  isReady(): boolean;
  isOpen(): boolean;
  open(): Promise<NavigationWindow>;
  isTrusted(url: string): boolean;
  registerProtocol(): unknown;
  subscribeOpenUrl(handler: (event: { preventDefault(): void }, url: string) => void): () => void;
  unavailable(error: unknown): void;
}
/** Navigation intent only: the latest bounded link never grants content access. */
export function attachContextApplicationNavigation(options: ApplicationNavigationOptions) {
  let stopped = false, registered = false;
  const navigation = new ContextLinkNavigation({
    async open() {
      if (stopped || !options.isOpen()) throw Error('context_navigation_closed');
      const window = await options.open();
      if (stopped || !options.isOpen()) throw Error('context_navigation_closed');
      return window;
    },
    isTrusted: options.isTrusted,
  });
  const acceptArguments = (args: readonly string[]) => {
    if (stopped || !options.isOpen()) return false;
    let accepted = false;
    for (const argument of args) if (navigation.accept(argument)) accepted = true;
    return accepted;
  };
  const flush = async () => {
    if (stopped || !options.isOpen()) return;
    try { await navigation.flush(); } catch (error) { options.unavailable(error); }
  };
  // Capture cold-start arguments before a later OS event can replace that intent.
  acceptArguments(options.argv);
  const unsubscribe = options.subscribeOpenUrl((event, url) => {
    if (stopped || !options.isOpen() || !navigation.accept(url)) return;
    event.preventDefault();
    if (options.isReady()) void flush();
  });
  return {
    async ready() {
      if (stopped || !options.isOpen()) return;
      if (!registered) { registered = true; options.registerProtocol(); }
      await flush();
    },
    secondInstance(args: readonly string[]): boolean {
      if (!acceptArguments(args)) return false;
      void flush(); return true;
    },
    dispose() { if (!stopped) { stopped = true; unsubscribe(); } },
  };
}
