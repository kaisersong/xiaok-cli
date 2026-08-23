import type { Command } from 'commander';
export declare function runDoctorCommand(cwd: string): Promise<string>;
/**
 * 逐个 provider 扫描候选 API Key（XIAOK_ 前缀 / 标准环境变量 / 配置文件），
 * 对每个候选发起最小化只读请求验证是否真正可用。
 *
 * 会发出真实网络请求，仅在用户显式执行 `xiaok doctor --check-keys` 时触发，
 * 不会在其它命令路径中被静默调用。
 */
export declare function runCheckKeysCommand(): Promise<string>;
export declare function registerDoctorCommands(program: Command): void;
