import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parseGoalVerificationDefinition } from '../goal/verification-definition.js';
function fields(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('loop_publication_config_shape'); }
export function freezeLoopPublicationValue(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeLoopPublicationValue);
    Object.freeze(value);
} return value; }
/** Explicit configuration only; recipes use the existing independent-definition
 * parser. No default criteria or completion proof is created here. */
export function parseLoopPublicationConfiguration(raw) {
    const encoded = json(raw);
    if (Buffer.byteLength(encoded) > 256 * 1024)
        throw Error('loop_publication_config_limit');
    const value = JSON.parse(encoded);
    fields(value, ['version', 'contract', 'verificationDefinitions']);
    if (value.version !== 1)
        throw Error('loop_publication_config_version');
    const c = value.contract;
    let stages;
    if (c?.kind === 'builtin-diagnostic') {
        fields(c, ['kind', 'scanner', 'objective', 'completionCriterion']);
        if (!['artifact-evidence-regression', 'kswarm-service-health'].includes(c.scanner))
            throw Error('loop_publication_config_scanner');
        stages = ['scan'];
    }
    else if (c?.kind === 'assistant') {
        fields(c, ['kind', 'assistantKind', 'objective', 'completionCriterion']);
        if (!['evening', 'morning'].includes(c.assistantKind))
            throw Error('loop_publication_config_assistant');
        stages = [];
    }
    else if (c?.kind === 'user-template') {
        fields(c, ['kind']);
        stages = ['execute', 'verify'];
    }
    else
        throw Error('loop_publication_config_kind');
    if (c.kind !== 'user-template')
        for (const key of ['objective', 'completionCriterion'])
            if (typeof c[key] !== 'string' || !c[key].trim())
                throw Error('loop_publication_config_text');
    fields(value.verificationDefinitions, ['run', 'stages']);
    fields(value.verificationDefinitions.stages, stages);
    value.verificationDefinitions.run = parseGoalVerificationDefinition(value.verificationDefinitions.run);
    for (const stage of stages)
        value.verificationDefinitions.stages[stage] = parseGoalVerificationDefinition(value.verificationDefinitions.stages[stage]);
    return freezeLoopPublicationValue(value);
}
