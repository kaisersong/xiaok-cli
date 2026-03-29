// Phase 1 占位实现，完整 OAuth 流程在 Phase 2 实现
import { saveCredentials, clearCredentials, loadCredentials } from './token-store.js';
export async function login() {
    console.log('\x1b[33m[Phase 1 占位]\x1b[0m 完整的浏览器 OAuth 流程将在 Phase 2 实现。');
    console.log('临时方案：请手动设置 credentials.json，或使用 xiaok config set api-key 配置 AI 模型 Key。');
    // 写入示例凭据（供开发测试用）
    const mock = {
        schemaVersion: 1,
        accessToken: 'PLACEHOLDER_TOKEN',
        refreshToken: 'PLACEHOLDER_REFRESH',
        enterpriseId: 'PLACEHOLDER_ENTERPRISE',
        userId: 'PLACEHOLDER_USER',
        expiresAt: new Date(Date.now() + 86400 * 1000 * 365).toISOString(),
    };
    await saveCredentials(mock);
    console.log('已写入占位凭据到 ~/.xiaok/credentials.json');
}
export async function logout() {
    await clearCredentials();
    console.log('已清除凭据。');
}
export async function status() {
    const creds = await loadCredentials();
    if (!creds) {
        console.log('未登录。运行 xiaok auth login 进行登录。');
        return;
    }
    console.log(`已登录\n  企业 ID：${creds.enterpriseId}\n  用户 ID：${creds.userId}\n  Token 过期：${creds.expiresAt}`);
}
