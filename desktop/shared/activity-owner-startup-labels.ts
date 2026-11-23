export const activityOwnerRuntimeUpgradeLabels = {
 zh: '旧版 xiaoK 后台仍在运行。请先保存工作并让在途任务结束，再重启电脑。重启后打开 xiaoK，即可完成后台组件升级。',
 en: 'The previous xiaoK background service is still running. Save your work and let active tasks finish, then restart your computer. Open xiaoK after the restart to finish updating its background service.',
} as const;

export const activityOwnerStartupLabels={
 zh:{versionMismatch:'xiaoK 的后台组件和当前版本不一致，部分功能暂时无法启动。请退出所有 xiaok 窗口后重新打开。',unavailable:'后台服务暂时无法启动，部分功能不可用。请退出所有 xiaok 窗口后重新打开。如仍失败，请联系管理员检查应用诊断日志、系统网络及安全软件的拦截日志。',localConnectionUnavailable:'本机后台服务未能及时连接，部分功能暂不可用。请退出所有 xiaok 窗口后重新打开。如仍失败，请联系管理员检查系统网络及安全软件的拦截日志。'},
 en:{versionMismatch:"xiaoK's background component does not match this version, so some features cannot start yet. Quit all xiaok windows and open it again.",unavailable:'Background services could not start, so some features are unavailable. Quit all xiaok windows and reopen the app. If this persists, ask your administrator to check application diagnostics, system networking and security software logs.',localConnectionUnavailable:'A local background service could not be reached in time, so some features are unavailable. Quit all xiaok windows and reopen the app. If this persists, ask your administrator to check system networking and security software logs.'},
} as const;
