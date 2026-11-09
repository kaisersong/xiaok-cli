import { types } from 'node:util';
import { createHash } from 'node:crypto';
const keys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf, own = Object.hasOwn, create = Object.create, freeze = Object.freeze, define = Object.defineProperty, apply = Reflect.apply, sort = Array.prototype.sort, json = JSON.stringify, isArray = Array.isArray, isSafe = Number.isSafeInteger, sameValue = Object.is, isProxy = types.isProxy, isPromise = types.isPromise;
const objectPrototype = Object.prototype, MAX = 1000000000000;
const nativeCreateHash = createHash;
const hashBirth = nativeCreateHash('sha256'), hashPrototype = prototype(hashBirth);
const nativeHashUpdate = descriptor(hashPrototype, 'update').value, nativeHashDigest = descriptor(hashPrototype, 'digest').value;
apply(nativeHashDigest, hashBirth, ['hex']);
export function dshFail(code = 'dsh_budget_invalid') {
    throw Error(code);
}
export function dshRecord(raw, names) {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || isPromise(raw) || isArray(raw))
        dshFail();
    const p = prototype(raw);
    if (p !== null && p !== objectPrototype)
        dshFail();
    const found = keys(raw);
    if (found.length !== names.length)
        dshFail();
    const out = create(null);
    for (let i = 0; i < names.length; i++) {
        const name = names[i], row = descriptor(raw, name);
        if (!row || !own(row, 'value'))
            dshFail();
        define(out, name, {__proto__:null,
            value: row.value, enumerable: true
        });
    }
    return out;
}
export function dshId(v) {
    if (typeof v !== 'string' || v.length < 1 || v.length > 256 || /[\x00-\x1f\x7f]/.test(v))
        dshFail();
    return v;
}
export function dshHash(v) {
    if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
        dshFail();
    return v;
}
export function dshInteger(v, min = 0, max = MAX) {
    if (!isSafe(v) || sameValue(v, -0) || v < min || v > max)
        dshFail();
    return v;
}
export function dshAdd(a, b) {
    const n = a + b;
    if (!isSafe(n) || sameValue(n, -0) || n < 0)
        dshFail('dsh_budget_corrupt');
    return n;
}
function canonical(v) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        return json(v);
    if (isArray(v)) {
        let out = '[';
        for (let i = 0; i < v.length; i++)
            out += (i ? ',' : '') + canonical(v[i]);
        return out + ']';
    }
    const names = keys(v);
    apply(sort, names, []);
    let out = '[';
    for (let i = 0; i < names.length; i++)
        out += (i ? ',' : '') + '[' + json(names[i]) + ',' + canonical(v[names[i]]) + ']';
    return out + ']';
}
export function dshDigest(domain, value) {
    const hash = nativeCreateHash('sha256');
    apply(nativeHashUpdate, hash, ['[' + json(domain) + ',' + canonical(value) + ']']);
    return apply(nativeHashDigest, hash, ['hex']);
}
function common(v) {
    dshId(v.accountId);
    dshId(v.operationKey);
    dshInteger(v.sequence, 1, 64);
    dshId(v.attemptId);
}
export function parseDshInput(purpose, input) {
    let v;
    if (purpose === 'open') {
        v = dshRecord(input, ['accountId', 'tokenLimit', 'costLimitMicros', 'currency', 'scale', 'validUntil']);
        dshId(v.accountId);
        dshInteger(v.tokenLimit, 1);
        dshInteger(v.costLimitMicros, 1);
        if (v.currency !== 'USD' || v.scale !== 6)
            dshFail();
        dshInteger(v.validUntil, 0, 1e15);
    }
    else if (purpose === 'reserve') {
        v = dshRecord(input, ['accountId', 'operation', 'attempt']);
        dshId(v.accountId);
        const op = dshRecord(v.operation, ['operationKey', 'purpose', 'inputId', 'evidenceHash', 'semanticHash', 'threadHash', 'workId', 'maxAttempts', 'deadline']);
        dshId(op.operationKey);
        dshId(op.inputId);
        dshHash(op.evidenceHash);
        dshHash(op.semanticHash);
        dshHash(op.threadHash);
        dshInteger(op.maxAttempts, 1, 64);
        dshInteger(op.deadline, 0, 1e15);
        if (op.purpose === 'draft')
            dshId(op.workId);
        else if ((op.purpose !== 'assessment' && op.purpose !== 'preview') || op.workId !== null)
            dshFail();
        const at = dshRecord(v.attempt, ['attemptId', 'sequence', 'bodyHash', 'providerId', 'modelId', 'modelProfileId', 'pricingHash', 'pricingKnown', 'maxInputTokens', 'maxOutputTokens', 'maxTokens', 'maxCostMicros', 'toolRounds']);
        dshId(at.attemptId);
        dshInteger(at.sequence, 1, 64);
        dshHash(at.bodyHash);
        dshId(at.providerId);
        dshId(at.modelId);
        dshId(at.modelProfileId);
        dshHash(at.pricingHash);
        dshInteger(at.toolRounds, 0, 0);
        if (at.pricingKnown !== true || at.toolRounds !== 0)
            dshFail();
        dshInteger(at.maxInputTokens, 1);
        dshInteger(at.maxOutputTokens, 1);
        dshInteger(at.maxTokens, 1);
        dshInteger(at.maxCostMicros, 1);
        if (dshAdd(at.maxInputTokens, at.maxOutputTokens) !== at.maxTokens)
            dshFail();
        const out = create(null);
        define(out, 'accountId', {__proto__:null,
            value: v.accountId, enumerable: true
        });
        define(out, 'operation', {__proto__:null,
            value: freeze(op), enumerable: true
        });
        define(out, 'attempt', {__proto__:null,
            value: freeze(at), enumerable: true
        });
        v = out;
    }
    else if (purpose === 'marker' || purpose === 'sent') {
        v = dshRecord(input, ['accountId', 'operationKey', 'sequence', 'attemptId', 'bodyHash']);
        common(v);
        dshHash(v.bodyHash);
    }
    else if (purpose === 'unknown') {
        v = dshRecord(input, ['accountId', 'operationKey', 'sequence', 'attemptId', 'reason']);
        common(v);
        if (v.reason !== 'transport_unknown' && v.reason !== 'usage_unknown')
            dshFail();
    }
    else if (purpose === 'settle_conservative') {
        v=dshRecord(input,['accountId','operationKey','sequence','attemptId','actualTokens','chargedCostUpperBoundMicros','pricingHash','usageReceiptHash']);
        common(v);dshInteger(v.actualTokens);dshInteger(v.chargedCostUpperBoundMicros);dshHash(v.pricingHash);dshHash(v.usageReceiptHash);
    }
    else if (purpose === 'settle') {
        v = dshRecord(input, ['accountId', 'operationKey', 'sequence', 'attemptId', 'actualTokens', 'actualCostMicros', 'usageReceiptHash']);
        common(v);
        dshInteger(v.actualTokens);
        dshInteger(v.actualCostMicros);
        dshHash(v.usageReceiptHash);
    }
    else if ((purpose === 'work_policy'||purpose==='work_policy_sync')) {
        v = dshRecord(input, ['accountId', 'maxActiveWorks', 'maxDraftRequestsPerWork']);
        dshId(v.accountId);
        dshInteger(v.maxActiveWorks); dshInteger(v.maxDraftRequestsPerWork);
    }
    else if (purpose === 'work_reserve') {
        v = dshRecord(input, ['accountId','bindingId','generation','scope','thread','initialTokens','initialCostMicros','deadline','command']);
        dshId(v.accountId); dshId(v.bindingId); dshInteger(v.generation,1,1);
        dshInteger(v.initialTokens,1); dshInteger(v.initialCostMicros,1); dshInteger(v.deadline,0,1e15);
        const scope=dshRecord(v.scope,['profileId','workspaceId']);
        dshId(scope.profileId);dshId(scope.workspaceId);
        const thread=dshRecord(v.thread,['tenantId','workspaceId','sourceBindingId','provider','repositoryId','kind','threadId']);
        for(const name of ['tenantId','workspaceId','sourceBindingId','repositoryId','threadId'])dshId(thread[name]);
        if(thread.provider!=='github'||thread.kind!=='issue')dshFail();
        const command=dshRecord(v.command,['operationKey','semanticPayloadHash','assessmentRef','purpose']);
        dshId(command.operationKey);dshHash(command.semanticPayloadHash);dshId(command.assessmentRef);
        if(command.purpose!=='draft_admission'&&command.purpose!=='draft_prepare')dshFail();
        const out=create(null);
        for(const name of ['accountId','bindingId','generation','initialTokens','initialCostMicros','deadline'])define(out,name,{__proto__:null,value:v[name],enumerable:true});
        define(out,'scope',{__proto__:null,value:freeze(scope),enumerable:true});define(out,'thread',{__proto__:null,value:freeze(thread),enumerable:true});define(out,'command',{__proto__:null,value:freeze(command),enumerable:true});v=out;
    }
    else if(purpose==='draft_finalize') {
        v=dshRecord(input,['accountId','reservationId','bindingId','ownerWorkId','operationKey','semanticPayloadHash','inputManifestHash','attemptId']);
        for(const name of ['accountId','reservationId','bindingId','ownerWorkId','operationKey','attemptId'])dshId(v[name]);
        dshHash(v.semanticPayloadHash);dshHash(v.inputManifestHash);
    }
    else if(purpose==='work_read') {
        v=dshRecord(input,['accountId','bindingId','generation','operationKey','semanticPayloadHash','purpose']);
        for(const name of ['accountId','bindingId','operationKey'])dshId(v[name]);
        dshInteger(v.generation,1,1);dshHash(v.semanticPayloadHash);
        if(v.purpose!=='draft_admission'&&v.purpose!=='draft_prepare')dshFail();
    }
    else if (purpose === 'work_bind') {
        v=dshRecord(input,['accountId','reservationId','attestationId','operationKey','semanticPayloadHash','commandId','result','ownerWorkId']);
        for(const name of ['accountId','reservationId','attestationId','operationKey','commandId'])dshId(v[name]);
        dshHash(v.semanticPayloadHash);
        if(v.result!=='applied'&&v.result!=='blocked'&&v.result!=='no_effect')dshFail();
        if(v.result==='applied')dshId(v.ownerWorkId);else if(v.ownerWorkId!==null)dshFail();
    }
    else if (purpose === 'work_close') {
        v=dshRecord(input,['accountId','reservationId','closureId','ownerWorkId','commandReceiptsHash','usageHash']);
        for(const name of ['accountId','reservationId','closureId'])dshId(v[name]);
        if(v.ownerWorkId!==null)dshId(v.ownerWorkId);
        dshHash(v.commandReceiptsHash);dshHash(v.usageHash);
    }
    else if (purpose === 'read') {
        v = dshRecord(input, ['accountId']);
        dshId(v.accountId);
    }
    else
        dshFail();
    return freeze(v);
}
export function dshBudgetCommandDigest(purpose, input) {
    return dshDigest('dsh-budget-command-v1', {
        purpose, input: parseDshInput(purpose, input)
    });
}
export function parseDshAuthority(raw) {
    const a = dshRecord(raw, ['requestSource', 'profileId', 'workspaceId', 'tenantId', 'mandateId', 'mandateRevision', 'authorizationEpoch', 'authorityHash', 'commandDigest']);
    if (a.requestSource !== 'user' && a.requestSource !== 'scheduler' && a.requestSource !== 'agent')
        dshFail('dsh_actor_forbidden');
    const ids = ['profileId', 'workspaceId', 'tenantId', 'mandateId'];
    for (let i = 0; i < ids.length; i++)
        dshId(a[ids[i]]);
    dshInteger(a.mandateRevision, 1);
    dshInteger(a.authorizationEpoch, 1);
    dshHash(a.authorityHash);
    dshHash(a.commandDigest);
    return freeze(a);
}
export function checkDshSource(purpose, a) {
    if (a.requestSource === 'agent' || ((purpose === 'open' || purpose === 'work_policy') && a.requestSource !== 'user') || (purpose !== 'open' && purpose !== 'work_policy' && purpose !== 'read' && a.requestSource !== 'scheduler'))
        dshFail('dsh_actor_forbidden');
}
