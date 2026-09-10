export interface RoomWorkspaceLabels {
  localCommands: string; localCommandsHint: string;
  editInstructions: string; instructionsLocation: string; publishSuccess: (revision: number) => string;
  technicalDetails: string; shortVersion: (id: string) => string; agentAuthor: string;
  registeredEvent: string; confirmedEvent: string; updatedEvent: string;
  retryChange: string;
  userAuthor: string; unknownAuthor: string;
  mapProject: string; workFolder: string; artifactsFolder: string; mappingHint: string; mappingSharedHint: string;
  inlineInstructions: string; fileInstructions: string; readSource: string;
  sharedReadGrant: string; addTemplateFile: string; relativePath: string; fileContent: string; remove: string; previewIncomplete: string;
  filesTab: string; instructionsTab: string; settings: string; root: string; existing: string; create: string; unset: string;
  selectDirectory: string; directoryName: string; template: string; templateHelp: string; preview: string; confirm: string; cancel: string;
  conflicts: string; overlap: string; acknowledgeOverlap: string; directory: string; registered: string; empty: string; unavailable: string;
  loading: string; retry: string; permissionDenied: string; readOnly: string; noWorkspace: string; noSandbox: string;
  publish: string; published: string; sourceFile: string; sourceChanged: string; sourceBefore: string; sourceAfter: string;
  oldRules: string; oldContent: string; confirmArtifact: string; registerArtifact: string; producer: string; version: (revision: number) => string;
  pendingSync: string; nextPage: string; parentDirectory: string; refresh: string; error: string; noTasks: string;
  operationPending: string; cancelChange: string; phases: Record<string, string>; artifactStates: Record<string, string>;
}
export const roomWorkspaceZh: RoomWorkspaceLabels = {
  localCommands: '允许本机命令执行', localCommandsHint: '允许此空间调用已安装的命令行工具及登录配置。命令拥有当前电脑账户的权限，不受工作目录限制。关闭后停止正在执行的空间任务；开启后对新任务生效。',
  editInstructions: '编辑说明', instructionsLocation: '说明保存在本协作空间的“工作说明”中，供后续协作任务使用。', publishSuccess: revision => `工作说明已发布（版本 ${revision}）`,
  technicalDetails: '技术详情', shortVersion: id => `版本 ${id}`, agentAuthor: '智能体输出',
  registeredEvent: '成果已登记，可在文件页查看获授权的内容', confirmedEvent: '成果版本已确认', updatedEvent: '工作区状态已更新',
  retryChange: '重试原绑定变更',
  userAuthor: '人工文件', unknownAuthor: '作者未知',
  mapProject: '映射项目目录', workFolder: '项目工作目录（相对路径）', artifactsFolder: '成果目录（相对路径）', mappingHint: '留空使用空间根目录；不会按项目标题自动建目录或移动文件。', mappingSharedHint: '多个项目使用同一目录会共同影响这些文件；项目验收仍由 KSwarm 管理。',
  inlineInstructions: '直接填写说明', fileInstructions: '关联说明文件', readSource: '读取来源文件并比较',
  sharedReadGrant: '允许当前空间成员读取此工作目录的共享文件', addTemplateFile: '添加模板文件', relativePath: '相对路径', fileContent: '文件内容', remove: '移除建议项', previewIncomplete: '仅展示部分内容',
  filesTab: '文件', instructionsTab: '工作说明', settings: '工作区设置', root: '工作目录', existing: '选择已有目录', create: '新建目录', unset: '暂不设置',
  selectDirectory: '选择目录', directoryName: '新目录名称', template: '自定义目录模板', templateHelp: '可不填写；每行一个相对目录名称，不强制任何目录结构。预览取消不会写入文件。', preview: '预览变更', confirm: '确认变更', cancel: '取消',
  conflicts: '目标冲突，不会覆盖已有文件', overlap: '与其他空间共享同一批文件', acknowledgeOverlap: '我确认共享这些文件，目录重叠不提供隔离', directory: '目录浏览', registered: '已登记成果', empty: '暂无内容', unavailable: '工作区暂不可用',
  loading: '正在读取工作区…', retry: '重新读取', permissionDenied: '无权读取或修改此工作区', readOnly: '只读；修改需要空间管理员权限', noWorkspace: '尚未设置工作目录；可以交流，文件工作需先绑定目录。', noSandbox: '共同目录是工作约定，不是文件系统沙箱。',
  publish: '发布新版本', published: '已发布说明', sourceFile: '说明来源文件（相对路径）', sourceChanged: '来源文件已变化，确认发布前执行仍使用旧版', sourceBefore: '已发布版本', sourceAfter: '来源文件当前内容',
  oldRules: '规则已更新，当前执行仍使用旧版', oldContent: '旧内容不可用；不会把当前文件冒充旧版本', confirmArtifact: '确认此版本', registerArtifact: '登记文件', producer: '作者 / 来源任务', version: revision => `版本 ${revision}`,
  pendingSync: '本地已登记，同步待完成', nextPage: '下一页', parentDirectory: '返回上级目录', refresh: '刷新', error: '操作未完成，请重新读取状态后重试', noTasks: '暂无工作区执行任务',
  operationPending: '操作回执未确认，请刷新状态；不会自动重试提交', cancelChange: '撤销尚未提交的变更', phases: { active: '可用', unbound: '未设置', draining: '等待旧任务实际退出', resolving: '正在解析绑定', activation_failed: '绑定激活失败', unavailable: '目录不可用', offline: '离线', unauthorized: '授权已失效', origin_unavailable: '原主机不可用', mapping_required: '需要重新映射项目目录' },
  artifactStates: { draft: '待确认', confirmed: '已确认', superseded: '已有新版本', missing: '文件已缺失', changed: '文件已变化', pending: '登记待完成', project: '项目验收由 KSwarm 管理' },
};
export const roomWorkspaceEn: RoomWorkspaceLabels = {
  localCommands: 'Allow local commands', localCommandsHint: 'Allow this room to use installed CLI tools and their login configuration. Commands run with your computer account permissions, beyond the workspace directory. Turning this off stops active room tasks; turning it on applies to new tasks.',
  editInstructions: 'Edit instructions', instructionsLocation: 'Instructions are saved in this room’s Instructions tab for future collaboration tasks.', publishSuccess: revision => `Instructions published (version ${revision})`,
  technicalDetails: 'Technical details', shortVersion: id => `Version ${id}`, agentAuthor: 'Agent output',
  registeredEvent: 'Artifact registered. Authorized content is available in Files.', confirmedEvent: 'Artifact version confirmed', updatedEvent: 'Workspace state updated',
  retryChange: 'Retry original binding change',
  userAuthor: 'User-provided file', unknownAuthor: 'Unknown author',
  mapProject: 'Map project directory', workFolder: 'Project working directory (relative path)', artifactsFolder: 'Artifact directory (relative path)', mappingHint: 'Leave blank to use the room root. No automatic directory creation or file moves.', mappingSharedHint: 'Projects using the same directory affect the same files. KSwarm still owns project acceptance.',
  inlineInstructions: 'Write instructions', fileInstructions: 'Link instruction file', readSource: 'Read source and compare',
  sharedReadGrant: 'Allow current room members to read shared files in this directory', addTemplateFile: 'Add template file', relativePath: 'Relative path', fileContent: 'File content', remove: 'Remove suggestion', previewIncomplete: 'Partial content shown',
  filesTab: 'Files', instructionsTab: 'Instructions', settings: 'Workspace settings', root: 'Working directory', existing: 'Use existing directory', create: 'Create directory', unset: 'Not now',
  selectDirectory: 'Choose directory', directoryName: 'New directory name', template: 'Custom directory template', templateHelp: 'Optional: one relative directory per line. No fixed layout. Cancelling a preview writes nothing.', preview: 'Preview changes', confirm: 'Confirm changes', cancel: 'Cancel',
  conflicts: 'Conflicts found; existing files will not be overwritten', overlap: 'These files are shared with another room', acknowledgeOverlap: 'I acknowledge that overlapping directories share files, not isolation', directory: 'Browse directory', registered: 'Registered artifacts', empty: 'No items', unavailable: 'Workspace unavailable',
  loading: 'Loading workspace…', retry: 'Reload', permissionDenied: 'Permission to read or change this workspace was denied', readOnly: 'Read-only; changes require the room owner', noWorkspace: 'No directory bound. Discussion is available; file work needs a working directory.', noSandbox: 'A shared directory is a working agreement, not a filesystem sandbox.',
  publish: 'Publish new version', published: 'Published instructions', sourceFile: 'Instruction source file (relative path)', sourceChanged: 'Source changed; runs keep the published version until confirmation', sourceBefore: 'Published version', sourceAfter: 'Current source content',
  oldRules: 'Instructions changed; this run retains its original version', oldContent: 'Old content unavailable; current bytes will not be shown as the old version', confirmArtifact: 'Confirm version', registerArtifact: 'Register file', producer: 'Author / source task', version: revision => `Version ${revision}`,
  pendingSync: 'Registered locally; synchronization pending', nextPage: 'Next page', parentDirectory: 'Parent directory', refresh: 'Refresh', error: 'Operation incomplete. Reload the authoritative state before retrying.', noTasks: 'No workspace executions',
  operationPending: 'Receipt not confirmed. Refresh state; submission is not retried automatically.', cancelChange: 'Cancel uncommitted change', phases: { active: 'Available', unbound: 'Not configured', draining: 'Waiting for execution release', resolving: 'Resolving binding', activation_failed: 'Activation failed', unavailable: 'Directory unavailable', offline: 'Offline', unauthorized: 'Authorization revoked', origin_unavailable: 'Origin host unavailable', mapping_required: 'Project mapping required' },
  artifactStates: { draft: 'Draft', confirmed: 'Confirmed', superseded: 'Superseded', missing: 'Missing', changed: 'Changed', pending: 'Registration pending', project: 'Project acceptance is owned by KSwarm' },
};
Object.assign(roomWorkspaceZh.phases, { unconfigured: '未设置', admitted: '已接纳', running: '执行中', releasing: '正在清理', released: '资源已释放', valid: '已授权', cancel_requested: '已请求取消', revoked: '授权已撤销', orphaned: '执行归属待核实', completed: '已完成', failed: '失败', updating: '映射更新中' });
Object.assign(roomWorkspaceEn.phases, { unconfigured: 'Not configured', admitted: 'Admitted', running: 'Running', releasing: 'Releasing resources', released: 'Resources released', valid: 'Authorized', cancel_requested: 'Cancellation requested', revoked: 'Authorization revoked', orphaned: 'Execution ownership unresolved', completed: 'Completed', failed: 'Failed', updating: 'Updating mapping' });
