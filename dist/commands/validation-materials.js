import { selectExplicitValidationFiles } from '../runtime/verification/material-selection.js';
import { authorizeProductValidationMaterials } from '../runtime/verification/product-material-authorization.js';
/** CLI host callback for an actual pending validation. Paths come exclusively
 * from repeated user --validation-material arguments, never model tool input. */
export async function authorizeCliValidationMaterials(input) {
    if (input.requestSource !== 'user')
        throw Error('validation_material_user_required');
    input.signal?.throwIfAborted();
    input.assertCurrent();
    const operation = structuredClone(input.operation), materials = selectExplicitValidationFiles([...input.selectedPaths], input.cwd);
    return authorizeProductValidationMaterials({ requestSource: 'user', draft: { ...operation, materials }, client: input.client, assertCurrent: input.assertCurrent, signal: input.signal,
        async review(value) {
            input.writeReview(['本次隔离验证需要系统授权读取以下文件：', ...value.materials.map(item => `${item.path}\n${item.size} bytes · SHA-256 ${item.sha256}`), `验证命令：${value.exactCommand.argv.map(arg => JSON.stringify(arg)).join(' ')}`, `工作目录：${value.exactCommand.cwdRelative}`, `有效期至：${new Date(value.expiresAt).toISOString()}`].join('\n'));
        } });
}
