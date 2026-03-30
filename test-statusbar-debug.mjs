import { StatusBar } from './dist/ui/statusbar.js';
import { getCurrentBranch } from './dist/utils/git.js';

const sb = new StatusBar();
sb.init('claude-opus-4-6', 'test-session', process.cwd());

const branch = await getCurrentBranch(process.cwd());
console.log('Branch:', JSON.stringify(branch));
sb.updateBranch(branch);

sb.update({ inputTokens: 100, outputTokens: 200, budget: 4000 });

const line = sb.getStatusLine();
console.log('Status line:', line);
