#!/usr/bin/env node
import { installWarningFilter } from './runtime/warnings.js';

installWarningFilter();
await import('./main.js');
