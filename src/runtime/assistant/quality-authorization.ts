import { createHash } from 'node:crypto';
import { z } from 'zod';
import { bindingSchema, dataSchema, evaluateAssistantQuality, issueAssistantQualityQualification, type AssistantQualityDataset } from './quality-qualification.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const qualityContextSchema = z.object({ binding: bindingSchema, scopes: z.array(z.enum(['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'])).max(6), analysisContract: z.string().min(1).max(256), modelEpoch: z.number().int().positive(), configFingerprint: hash }).strict();
/** Main-frozen human protocol; never generated or changed by the prediction model. */
export const ASSISTANT_QUALITY_REVIEW_INSTRUCTIONS={
 version:'human-review-v1',
 riskDefinition:'严重风险 severe=true：可核实事实中存在明确截止期限、错过期限的严重后果，或明确的实质损失风险。severe=false：根据本冻结规则完成复核后未发现上述风险。事实不足时不要猜测或批量填 false，应暂停复核并补齐事实后重新 freeze。严重风险必须在模型预测前由真实结构化事实或人工事前复核固定，不能由模型设定，也不能看预测后修改。',
 actionLabels:{needs_action:'存在明确且当前需要本人采取的下一步行动；仅有模糊可能性不算。',wait:'当前应等待他人、后续事件或约定时间，暂无需要本人立即执行的行动。',unknown:'现有最小事实不足以判断，或两位标注者存在尚未由用户裁决的分歧。不得为了通过评估而猜测。'},
 annotationProcedure:'两位真实标注者按同一冻结协议独立标注 firstLabel / secondLabel，不复制模型预测作为人工标签。标注时避免查看预测字段，分别保留原始判断；若原始标签不同，由用户依据事实填写 userAdjudication，或留空按 unknown 计入报告。用户导入时确认本人已核实这些人工记录；该来源仅为 user-attested，不是 independently verified。',
 editableFields:{risk_review:'仅填写 riskLabels[].severe 为 true/false。id、digest、frozen 中的规则/说明/事实均不可编辑；已知风险不得被降级。',action_review:'仅填写 labels[].firstLabel、secondLabel 和可选 userAdjudication。不得改 id、digest、frozen、prediction 或 severe。'},
 README:'两阶段真实操作：1. 在助理质量复核入口导出；未知风险时获得 risk_review，先读 frozen.reviewInstructions 和每条最小事实，由人工填写 riskLabels，保存文件后在原生选择器中导入并确认人工来源。此阶段不授予资格。2. 风险固定后再次点导出，主程才通过共享预算执行模型分类，生成 action_review；由两人独立填写 labels，用户核对分歧、必要时裁决，保存后再次原生导入。标注者不能使用模型自动生成的标签冒充人工判断；没有真实标签就保持 unknown。3. 查看质量状态中的 precision、recall、unknownRate、needsAction、seriousMisses。主程维护者可调用 workflow.report({requestSource:"user"}) 提取通过或失败的完整重算报告、Wilson 区间、原始计数及用户确认来源；报告不含原文事实。precision=TP/(TP+FP)，recall=TP/(TP+FN)，unknownRate=未知人工判断数/完整样本数。门槛为完整至少100例、至少30例 needs_action、precision>=0.90、recall>=0.95、unknownRate<=0.10、严重漏报0且风险覆盖完整；区间用于报告不替换既定门槛。未知预测遇到真实行动标签按漏报计算。4. 禁止修改协议/样本/风险/预测来追求通过；配置、授权变化须重新 freeze。显式撤销后，仅仍匹配当前来源/模型的原文件可经用户重新确认导入；旧待发送记录不会重绑。5. 若模型预测中途失败，同一 digest 不得重新发送预测。请显式选择“废弃本轮复核（可重新导出）”，再导出建立新的 freeze；这不会重置共享预算。共享预算不足时，应等待 24 小时滚动窗口腾出预算，不能靠重复点击或废弃绕过。发生 native breach 的契约被永久封禁，不会自动解锁；撤销、重新导出和等待 24 小时均不能解除该封禁。'
} as const;
const reviewInstructionsSchema=z.object({version:z.string().max(100),riskDefinition:z.string().max(3000),actionLabels:z.object({needs_action:z.string().max(1000),wait:z.string().max(1000),unknown:z.string().max(1000)}).strict(),annotationProcedure:z.string().max(3000),editableFields:z.object({risk_review:z.string().max(1000),action_review:z.string().max(1000)}).strict(),README:z.string().max(10000)}).strict();
export const qualityRecordSchema = z.object({ assessmentId: z.string().uuid(), generation: z.number().int().nonnegative(), reviewInstructions:reviewInstructionsSchema,phase: z.enum(['frozen', 'risk_exported', 'predicted', 'exported', 'assessed']), dataset: dataSchema, facts: z.array(z.object({ id: z.string().min(1).max(256), title: z.string().max(200), status: z.string().max(40), updatedAt: z.number().int(), promptSummary: z.string().max(500).optional(), severe: z.boolean().nullable().optional(),sourceReference:z.object({kind:z.string().min(1).max(80),id:z.string().min(1).max(512)}).strict().optional() }).strict()).max(10000), context: qualityContextSchema, digest: hash, attestation: z.object({ provenance: z.literal('user-attested'), independentlyVerified: z.literal(false), userId: z.string().min(1).max(256), text: z.string().min(1).max(1000), at: z.number().int().nonnegative() }).strict().nullable(), riskReview: z.string().max(4000000).nullable().default(null), riskAttestation: z.object({ provenance: z.literal('user-attested'), independentlyVerified: z.literal(false), userId: z.string().min(1).max(256), text: z.string().min(1).max(1000), at: z.number().int().nonnegative() }).strict().nullable().default(null), review: z.string().max(4000000).nullable(), reportDigest: hash.nullable() }).strict();
export type QualityRecord = z.infer<typeof qualityRecordSchema>;
export function qualityDigest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function frozenQualityDigest(record: Pick<QualityRecord, 'assessmentId' | 'dataset' | 'facts' | 'context' | 'reviewInstructions'>): string {
    return qualityDigest({ assessmentId: record.assessmentId,reviewInstructions:record.reviewInstructions, dataset: { ...record.dataset, cases: record.dataset.cases.map(({ id, prediction, severe }) => ({ id, prediction, severe })) }, facts: qualityRecordSchema.shape.facts.parse(record.facts), context: record.context });
}
export const humanQualityReviewSchema = z.object({ version: z.literal(1), type: z.literal('action_review'), assessmentId: z.string().uuid(), digest: hash, frozen: z.unknown().optional(), predictions: z.array(z.object({ id: z.string(), prediction: z.enum(['needs_action', 'wait', 'unknown']) }).strict()).max(10000).optional(), labels: z.array(z.object({ id: z.string().min(1).max(256), firstLabel: z.enum(['needs_action', 'wait', 'unknown']), secondLabel: z.enum(['needs_action', 'wait', 'unknown']), userAdjudication: z.enum(['needs_action', 'wait', 'unknown']).optional() }).strict()).max(10000) }).strict();
export function applyHumanQualityReview(record: QualityRecord, raw: unknown): AssistantQualityDataset {
    const review = humanQualityReviewSchema.parse(raw);
    if (review.assessmentId !== record.assessmentId || review.digest !== record.digest || review.labels.length !== record.dataset.cases.length)
        throw Error('assistant_quality_review_mismatch');
    if (review.frozen !== undefined && JSON.stringify(review.frozen) !== JSON.stringify(exportedQualityFacts(record)))
        throw Error('assistant_quality_frozen_changed');
    if (review.predictions !== undefined && JSON.stringify(review.predictions) !== JSON.stringify(record.dataset.cases.map(({ id, prediction }) => ({ id, prediction }))))
        throw Error('assistant_quality_predictions_changed');
    const labels = new Map(review.labels.map(row => [row.id, row]));
    if (labels.size !== review.labels.length)
        throw Error('assistant_quality_duplicate_labels');
    return dataSchema.parse({ ...record.dataset, cases: record.dataset.cases.map(row => {
            const label = labels.get(row.id);
            if (!label)
                throw Error('assistant_quality_missing_label');
            return { ...row, ...label };
        }) });
}
export function exportedQualityFacts(record: QualityRecord) { return { reviewInstructions:record.reviewInstructions,riskLabelPolicy: 'pre-frozen-main-facts;unknown-blocks-qualification', binding: record.dataset.binding, populationCount: record.dataset.population.ids.length, protocol: record.dataset.protocol, cases: record.dataset.cases, facts: record.facts }; }
export function exportedRiskFacts(record: QualityRecord) { return { reviewInstructions:record.reviewInstructions,riskLabelPolicy: 'pre-frozen-main-or-human', binding: record.dataset.binding, populationCount: record.dataset.population.ids.length, protocol: record.dataset.protocol, facts: record.facts }; }
export const humanRiskReviewSchema = z.object({ version: z.literal(1), type: z.literal('risk_review'), assessmentId: z.string().uuid(), digest: hash, frozen: z.unknown().optional(), riskLabels: z.array(z.object({ id: z.string().min(1).max(256), severe: z.boolean() }).strict()).max(10000) }).strict();
export function applyHumanRiskReview(record: QualityRecord, raw: unknown) {
    const review = humanRiskReviewSchema.parse(raw);
    if (review.assessmentId !== record.assessmentId || review.digest !== record.digest || review.riskLabels.length !== record.dataset.cases.length)
        throw Error('assistant_quality_risk_mismatch');
    if (review.frozen !== undefined && JSON.stringify(review.frozen) !== JSON.stringify(exportedRiskFacts(record)))
        throw Error('assistant_quality_risk_frozen_changed');
    const labels = new Map(review.riskLabels.map(row => [row.id, row.severe]));
    if (labels.size !== review.riskLabels.length || record.dataset.cases.some(row => !labels.has(row.id)))
        throw Error('assistant_quality_risk_ids');
    for (const fact of record.facts)
        if (typeof fact.severe === 'boolean' && labels.get(fact.id) !== fact.severe)
            throw Error('assistant_quality_known_risk_changed');
    return labels;
}
export function hasFrozenRiskCoverage(record: QualityRecord): boolean {
    const facts = new Map(record.facts.map(fact => [fact.id, fact]));
    if (!record.dataset.cases.every(row => typeof facts.get(row.id)?.severe === 'boolean' && facts.get(row.id)?.severe === row.severe))
        return false;
    if (record.riskReview !== null) {
        if (!record.riskAttestation)
            return false;
        const review = humanRiskReviewSchema.safeParse(JSON.parse(record.riskReview));
        if (!review.success)
            return false;
        const labels = new Map(review.data.riskLabels.map(row => [row.id, row.severe]));
        if (review.data.assessmentId !== record.assessmentId || labels.size !== record.dataset.cases.length || review.data.riskLabels.length !== labels.size || record.dataset.cases.some(row => labels.get(row.id) !== row.severe))
            return false;
    }
    return true;
}
export type QualityContext = z.infer<typeof qualityContextSchema>;
export type QualityModelIdentity = {
    modelEpoch: number;
    configFingerprint: string;
};
/** Main/owner private port: reads actual current config/provider/model/key grant, never context table/cache/IPC. */
export type QualityModelReader = () => QualityModelIdentity;
export type QualityAssessmentIdentity = {
    assessmentId: string;
    generation: number;
    digest: string;
};
