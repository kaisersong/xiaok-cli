#!/usr/bin/env node
import { installWarningFilter } from './runtime/warnings.js';
import { configureSafeCrashCapture } from './utils/crash-reporter.js';

configureSafeCrashCapture();
installWarningFilter();
await import('./main.js');
