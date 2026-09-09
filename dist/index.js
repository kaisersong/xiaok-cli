#!/usr/bin/env node
import { installWarningFilter } from './runtime/warnings.js';
import { configureSafeCrashCapture } from './utils/crash-reporter.js';
if (process.argv[2] === '--room-discussion-v1') {
    // Route before importing main/chat: external discussion cannot initialize
    // ordinary session memory, plugin hooks, tools, or interactive background work.
    try {
        await (await import('./commands/room-discussion.js')).runRoomDiscussionCli(process.argv.slice(3));
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'room_discussion_failed'}\n`);
        process.exitCode = 1;
    }
}
else {
    configureSafeCrashCapture();
    installWarningFilter();
    await import('./main.js');
}
