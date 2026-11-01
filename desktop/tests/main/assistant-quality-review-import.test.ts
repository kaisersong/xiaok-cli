import {it,expect} from 'vitest';
import {readModel,setup,reviewed} from './fixtures/assistant-quality-workflow-fixture.js';
it('runs usable pre-prediction human risk review then model and human action review', async () => {
    const s = setup({}, true);
    try {
        const f = await s.service.freeze({ requestSource: 'user' });
        await expect(s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: f.digest })).rejects.toThrow('risk');
        await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
        const pkg = JSON.parse(s.file);
        expect(pkg.type).toBe('risk_review');
        expect(pkg.frozen.cases).toBeUndefined();expect(pkg.predictions).toBeUndefined();
        pkg.riskLabels = pkg.riskLabels.map((r: any) => ({ id: r.id, severe: r.id === 'case-0' }));
        s.file = JSON.stringify(pkg);
        const oldRisk = s.file;
        await s.service.import({ requestSource: 'user' });
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
        const { readQualityRecord } = await import('../../../src/runtime/assistant/quality-authorization.js');
        const risk = readQualityRecord(s.db)!;
        expect(risk.digest).not.toBe(f.digest);
        expect(risk.riskAttestation?.provenance).toBe('user-attested');
        await s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: risk.digest });
        s.file = oldRisk;
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
        const action = JSON.parse(s.file);
        expect(action.type).toBe('action_review');
        action.labels = action.frozen.cases.map((r: any) => ({ id: r.id, firstLabel: r.prediction, secondLabel: r.prediction }));
        s.file = JSON.stringify(action);
        expect((await s.service.import({ requestSource: 'user' })).status.state).toBe('passed');
    }
    finally {
        s.db.close();
    }
});
it('risk review rejects null, duplicate or missing risk labels and never grants qualification itself', async () => {
    const s = setup({}, true);
    try {
        const f = await s.service.freeze({ requestSource: 'user' });
        await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
        const pkg = JSON.parse(s.file), blank = s.file;
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        pkg.riskLabels = pkg.riskLabels.map((r: any) => ({ id: r.id, severe: false }));
        const filled = JSON.stringify(pkg);
        pkg.riskLabels[1].id = pkg.riskLabels[0].id;
        s.file = JSON.stringify(pkg);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow('risk_ids');
        s.file = filled;
        await s.service.import({ requestSource: 'user' });
        expect(s.service.currentReview({ requestSource: 'user' })).toMatchObject({ phase: 'frozen', riskCoverageComplete: true });
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
        s.file = filled;
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow('risk_locked');
        s.file = blank;
    }
    finally {
        s.db.close();
    }
});
it('known risks cannot export action labels before budgeted predictions; rejected export leaves frozen state', async () => { const s = setup(); try {
    const f = await s.service.freeze({ requestSource: 'user' });
    await expect(s.service.export({ requestSource: 'user', assessmentId: f.assessmentId })).rejects.toThrow('predictions_required');
    expect(s.file).toBe('');
    expect(s.service.currentReview({ requestSource: 'user' })?.phase).toBe('frozen');
    await s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: f.digest });
    await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
    expect(JSON.parse(s.file).type).toBe('action_review');
    await expect(s.service.export({ requestSource: 'user', assessmentId: f.assessmentId })).resolves.toMatchObject({ cancelled: false });
}
finally {
    s.db.close();
} });
it('readiness permits only explicit main user or scheduler actors and rejects agent or missing authority', async () => { const s = setup(); try {
    await reviewed(s);
    await s.service.import({ requestSource: 'user' });
    for (const requestSource of ['user', 'scheduler'] as const)
        expect(s.service.readiness({ requestSource }).qualityQualification).toBeTruthy();
    for (const requestSource of ['agent', undefined, 'forged'])
        expect(() => s.service.readiness({ requestSource } as any)).toThrow('source');
    expect(() => (s.service.readiness as any)()).toThrow();
    expect(() => s.service.readiness({ requestSource: 'scheduler', qualified: true } as any)).toThrow();
}
finally {
    s.db.close();
} });
it('both human-risk stages deny nonuser operations, and completed risk review still requires predictions before action export', async () => { const s = setup({}, true); try {
    const f = await s.service.freeze({ requestSource: 'user' });
    for (const requestSource of ['agent', 'scheduler'] as const) {
        await expect(s.service.export({ requestSource, assessmentId: f.assessmentId })).rejects.toThrow('source');
        await expect(s.service.import({ requestSource })).rejects.toThrow('source');
    }
    await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
    const pkg = JSON.parse(s.file);
    pkg.riskLabels = pkg.riskLabels.map((row: any) => ({ id: row.id, severe: false }));
    s.file = JSON.stringify(pkg);
    await s.service.import({ requestSource: 'user' });
    await expect(s.service.export({ requestSource: 'user', assessmentId: f.assessmentId })).rejects.toThrow('predictions_required');
    for (const requestSource of ['agent', 'scheduler'] as const) {
        const target = s.service.currentReview({ requestSource: 'user' })!;
        await expect(s.service.recordPredictions({ requestSource, assessmentId: target.assessmentId, expectedDigest: target.digest })).rejects.toThrow('source');
        await expect(s.service.import({ requestSource })).rejects.toThrow('source');
    }
}
finally {
    s.db.close();
} });
it('preserves parent-design unknown-label threshold and full diagnostics at ten versus eleven percent', async () => { for (const count of [10, 11]) {
    const s = setup();
    try {
        await reviewed(s);
        const pkg = JSON.parse(s.file);
        const wait = pkg.labels.filter((row: any) => row.firstLabel === 'wait');
        for (const row of wait.slice(0, count)) {
            row.firstLabel = 'unknown';
            row.secondLabel = 'unknown';
        }
        s.file = JSON.stringify(pkg);
        const { status } = await s.service.import({ requestSource: 'user' });
        expect(status.unknownRate).toBe(count / 100);
        expect(status.state).toBe(count === 10 ? 'passed' : 'failed');
        const { readCurrentAssistantQualityAssessment } = await import('../../../src/runtime/assistant/quality-authorization.js');
        const current = readCurrentAssistantQualityAssessment(s.db, readModel);
        if (count === 10)
            expect(current?.report).toMatchObject({ unknownLabels: 10, total: 100, needsAction: 30, seriousMisses: 0 });
        else
            expect(current).toBeUndefined();
    }
    finally {
        s.db.close();
    }
} });
it('exports frozen usable human instructions and rejects changed definitions in either stage',async()=>{const s=setup({},true);try{const f=await s.service.freeze({requestSource:'user'});await s.service.export({requestSource:'user',assessmentId:f.assessmentId});const risk=JSON.parse(s.file);expect(risk.frozen.reviewInstructions.README).toContain('两阶段');expect(risk.frozen.reviewInstructions.README).toContain('24 小时');expect(risk.frozen.reviewInstructions.README).toContain('永久封禁');expect(risk.frozen.reviewInstructions.README).toContain('不会重置共享预算');expect(risk.frozen.reviewInstructions.riskDefinition).toContain('截止');expect(risk.frozen.reviewInstructions.riskDefinition).toContain('损失');expect(risk.frozen.reviewInstructions.actionLabels).toHaveProperty('unknown');risk.riskLabels=risk.riskLabels.map((row:any)=>({id:row.id,severe:false}));const valid=JSON.stringify(risk);risk.frozen.reviewInstructions.riskDefinition='model chooses risk';s.file=JSON.stringify(risk);await expect(s.service.import({requestSource:'user'})).rejects.toThrow('frozen');s.file=valid;await s.service.import({requestSource:'user'});const target=s.service.currentReview({requestSource:'user'})!;await s.service.recordPredictions({requestSource:'user',assessmentId:target.assessmentId,expectedDigest:target.digest});await s.service.export({requestSource:'user',assessmentId:target.assessmentId});const action=JSON.parse(s.file);const instructions=action.frozen.reviewInstructions;expect(instructions.annotationProcedure).toContain('独立');expect(instructions.editableFields.action_review).toContain('userAdjudication');action.labels=action.frozen.cases.map((row:any)=>({id:row.id,firstLabel:row.prediction,secondLabel:row.prediction}));const validAction=JSON.stringify(action);instructions.actionLabels.needs_action='always pass';s.file=JSON.stringify(action);await expect(s.service.import({requestSource:'user'})).rejects.toThrow('frozen');s.file=validAction;await s.service.import({requestSource:'user'});expect(s.service.report({requestSource:'user'})).toMatchObject({report:{passed:true,total:100,unknownLabels:0},humanProvenance:'user-attested',independentlyVerified:false});expect(()=>s.service.report({requestSource:'agent'})).toThrow('source');}finally{s.db.close()}});
it('freezes main source references through risk/action review and forbids label edits to those references',async()=>{const s=setup({},true,true);try{const f=await s.service.freeze({requestSource:'user'});await s.service.export({requestSource:'user',assessmentId:f.assessmentId});const risk=JSON.parse(s.file);expect(risk.frozen.facts[0].sourceReference).toEqual({kind:'task',id:'synthetic-original-0'});risk.riskLabels=risk.riskLabels.map((row:any)=>({id:row.id,severe:false}));const validRisk=JSON.stringify(risk);risk.frozen.facts[0].sourceReference.id='forged';s.file=JSON.stringify(risk);await expect(s.service.import({requestSource:'user'})).rejects.toThrow('frozen');s.file=validRisk;await s.service.import({requestSource:'user'});const target=s.service.currentReview({requestSource:'user'})!;await s.service.recordPredictions({requestSource:'user',assessmentId:target.assessmentId,expectedDigest:target.digest});await s.service.export({requestSource:'user',assessmentId:target.assessmentId});const action=JSON.parse(s.file);action.labels=action.frozen.cases.map((row:any)=>({id:row.id,firstLabel:row.prediction,secondLabel:row.prediction}));const validAction=JSON.stringify(action);action.frozen.facts[0].sourceReference.kind='forged';s.file=JSON.stringify(action);await expect(s.service.import({requestSource:'user'})).rejects.toThrow('frozen');const labelEdit=JSON.parse(validAction);labelEdit.labels[0].sourceReference={kind:'task',id:'forged'};s.file=JSON.stringify(labelEdit);await expect(s.service.import({requestSource:'user'})).rejects.toThrow();s.file=validAction;expect((await s.service.import({requestSource:'user'})).status.state).toBe('passed');}finally{s.db.close()}});
it('strictly bounds main source reference fields and canonicalizes risk digest after severe is added',async()=>{const {qualityRecordSchema,frozenQualityDigest}=await import('../../../src/runtime/assistant/quality-authorization.js');const s=setup({},true,true);try{await s.service.freeze({requestSource:'user'});const record=JSON.parse(String(s.db.prepare('SELECT payload_json FROM assistant_quality_assessments').get()!.payload_json));for(const bad of [{kind:'k'.repeat(81),id:'one'},{kind:'task',id:'i'.repeat(513)},{kind:'task',id:'one',path:'/forged'}]){const copy=structuredClone(record);copy.facts[0].sourceReference=bad;expect(qualityRecordSchema.safeParse(copy).success).toBe(false)}record.facts[0]={...record.facts[0],severe:false};expect(frozenQualityDigest(record)).toBe(frozenQualityDigest(qualityRecordSchema.parse(record)));}finally{s.db.close()}});
