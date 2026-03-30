import { StatusBar } from './dist/ui/statusbar.js';

const sb = new StatusBar();
sb.init('claude-opus-4-6', 'test-session', process.cwd());
sb.updateBranch('main');
sb.update({ inputTokens: 100, outputTokens: 200, budget: 4000 });
const line = sb.getStatusLine();
console.log('Status line:', line);
console.log('Length:', line.length);
