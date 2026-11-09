import type { DecisionModelState } from '../../../shared/decision-model-types';
export interface LocalDecisionModelsLabels {
  title: string; manualOnly: string; refresh: string; loading: string; empty: string; actionError: string; changed: string; saved: string;
  clef: string; laya: string; selected: string; supported: string; unsupported: string; cancel: string; retry: string; download: string;
  start: string; stop: string; use: string; remove: string; details: string; source: string; revision: string; codeHash: string; runtime: string;
  notProvided: string; confirmRemove: string; confirmStart: string; dismiss: string; removeNotice: string; codeNotice: string;
  state: Record<DecisionModelState, string>; reason(value: string): string; progressLabel(name: string): string; progress(percent: number, file: string): string;
}
export const localDecisionModelsZh: LocalDecisionModelsLabels = {
  title: '本地决策模型', manualOnly: '手动下载和管理本地模型。选择仅保存模型配置，不启用自动记忆重排。', refresh: '刷新', loading: '正在读取模型状态…', empty: '没有可管理的本地模型。',
  actionError: '模型操作或状态读取失败，请刷新后重试。', changed: '模型信息已变化，请重新选择并确认。', saved: '配置已保存，自动记忆重排未启用。',
  clef: 'CLEF Flash MLX 4-bit', laya: 'Laya Multilingual', selected: '已选择', supported: '支持当前平台', unsupported: '当前平台不支持',
  cancel: '取消下载', retry: '重新下载', download: '下载', start: '启动', stop: '停止', use: '选择模型', remove: '删除', details: '详情',
  source: '来源', revision: '版本', codeHash: '代码摘要', runtime: '运行环境', notProvided: '未提供', confirmRemove: '确认删除', confirmStart: '确认启动', dismiss: '取消',
  removeNotice: '删除此模型的本地下载文件；清理前会先停止正在运行的模型。', codeNotice: '启动将执行所列来源的模型运行代码。请核对来源、版本和摘要后确认。文件校验不代表代码安全。',
  state: { not_installed: '未下载', downloading: '下载中', checking: '校验中', interrupted: '下载已中断', installed: '已下载', loading: '启动中', ready: '就绪', failed: '失败' },
  reason: value => value === 'unsupported_platform' ? '此模型不支持当前平台。' : value === 'insufficient_disk' ? '可用磁盘空间不足。' : value === 'hash_mismatch' ? '文件校验失败，请重新下载。' : '模型当前不可用，请查看状态并重试。',
  progressLabel: name => `${name} 下载进度`, progress: (percent, file) => `${percent}%${file ? ' · ' + file : ''}`,
};
export const localDecisionModelsEn: LocalDecisionModelsLabels = {
  title: 'Local decision models', manualOnly: 'Download and manage local models manually. Selecting a model saves configuration without enabling automatic memory reranking.', refresh: 'Refresh', loading: 'Loading model status…', empty: 'No local models are available to manage.',
  actionError: 'The model action or status request failed. Refresh and try again.', changed: 'Model information changed. Select and confirm again.', saved: 'Configuration saved. Automatic memory reranking remains disabled.',
  clef: 'CLEF Flash MLX 4-bit', laya: 'Laya Multilingual', selected: 'Selected', supported: 'Supported on this platform', unsupported: 'Unsupported on this platform',
  cancel: 'Cancel download', retry: 'Download again', download: 'Download', start: 'Start', stop: 'Stop', use: 'Select model', remove: 'Remove', details: 'Details',
  source: 'Source', revision: 'Revision', codeHash: 'Code hash', runtime: 'Runtime', notProvided: 'Not provided', confirmRemove: 'Confirm removal', confirmStart: 'Confirm start', dismiss: 'Cancel',
  removeNotice: 'Stop the model before removing its downloaded files.', codeNotice: 'Starting executes model runtime code from the listed source. Check the source, revision and hash before confirming. File verification does not establish code safety.',
  state: { not_installed: 'Not downloaded', downloading: 'Downloading', checking: 'Verifying', interrupted: 'Download interrupted', installed: 'Downloaded', loading: 'Starting', ready: 'Ready', failed: 'Failed' },
  reason: value => value === 'unsupported_platform' ? 'This model does not support the current platform.' : value === 'insufficient_disk' ? 'Not enough free disk space.' : value === 'hash_mismatch' ? 'File verification failed. Download again.' : 'The model is currently unavailable. Check its status and try again.',
  progressLabel: name => `${name} download progress`, progress: (percent, file) => `${percent}%${file ? ' · ' + file : ''}`,
};
