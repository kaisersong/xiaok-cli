import { formatModelFailure } from '../ai/runtime/model-failure.js';
import type { ModelRecoveryNotice } from '../ai/runtime/model-stream-recovery.js';
/** Only fixed-vocabulary diagnostics are rendered; stdout policy stays with the caller. */
export function formatModelRecoveryNotice(notice: ModelRecoveryNotice): string {
  const reason = notice.failure ? formatModelFailure(notice.failure) : '模型调用暂时失败，原因未识别';
  return `${reason}，${Math.ceil(notice.delayMs / 1000)} 秒后自动续接（第 ${notice.attempt} 次，恢复窗口剩余 ${Math.ceil(notice.remainingMs / 60000)} 分钟）。Esc 可中断。`;
}
