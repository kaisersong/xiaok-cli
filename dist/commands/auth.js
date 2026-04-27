import { login, logout, status } from '../auth/login.js';
export function registerAuthCommands(program) {
    const auth = program.command('auth').description('管理云之家连接认证');
    auth
        .command('login')
        .description('登录云之家账号（Phase 1 占位，Phase 2 实现完整 OAuth）')
        .action(async () => {
        await login();
    });
    auth
        .command('logout')
        .description('退出登录，清除本地凭据')
        .action(async () => {
        await logout();
    });
    auth
        .command('status')
        .description('查看当前登录状态')
        .action(async () => {
        await status();
    });
}
