const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const isDev = import.meta.env.DEV;

// Runtime level: URL param ?log=debug > localStorage > build-time default
function getLogLevel(): keyof typeof levels {
  const url = new URLSearchParams(window.location.search).get('log');
  if (url && levels[url as keyof typeof levels] !== undefined) {
    localStorage.setItem('xiaok-log-level', url);
    return url as keyof typeof levels;
  }
  const stored = localStorage.getItem('xiaok-log-level');
  if (stored && levels[stored as keyof typeof levels] !== undefined) {
    return stored as keyof typeof levels;
  }
  return isDev ? 'debug' : 'warn';
}

let currentLevel = getLogLevel();

function format(level: string, module: string, ...args: unknown[]): string {
  const ts = new Date().toISOString();
  const payload = args.map(a => typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)).join(' ');
  return `[${ts}] [${level}] [${module}] ${payload}`;
}

export const logControl = {
  get level() { return currentLevel; },
  set level(l: keyof typeof levels) {
    currentLevel = l;
    localStorage.setItem('xiaok-log-level', l);
    console.log(`[logger] level changed to ${l}`);
  },
  setDebug() { this.level = 'debug'; },
  setInfo() { this.level = 'info'; },
  setWarn() { this.level = 'warn'; },
};

export function createLogger(module: string) {
  return {
    debug: (...args: unknown[]) => { if (levels['debug'] >= levels[currentLevel]) console.log(format('debug', module, ...args)); },
    info: (...args: unknown[]) => { if (levels['info'] >= levels[currentLevel]) console.log(format('info', module, ...args)); },
    warn: (...args: unknown[]) => { if (levels['warn'] >= levels[currentLevel]) console.warn(format('warn', module, ...args)); },
    error: (...args: unknown[]) => { if (levels['error'] >= levels[currentLevel]) console.error(format('error', module, ...args)); },
  };
}

// Global setup: expose control on window for DevTools access
if (isDev && typeof window !== 'undefined') {
  (window as any).__xiaokLog = logControl;
}
