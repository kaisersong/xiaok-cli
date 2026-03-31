import type { Command } from 'commander';
export declare function runDoctorCommand(cwd: string): Promise<string>;
export declare function registerDoctorCommands(program: Command): void;
