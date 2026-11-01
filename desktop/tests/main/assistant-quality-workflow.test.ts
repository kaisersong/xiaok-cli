import {it,expect} from 'vitest';
import {readModel,setup,reviewed} from './fixtures/assistant-quality-workflow-fixture.js';
import {DatabaseSync} from 'node:sqlite';
import {migrateAssistantQuality} from '../../electron/assistant-quality-workflow.js';
import {readAssistantQualityAuthorization} from '../../../src/runtime/assistant/quality-authorization.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readAssistantQualityQualification} from '../../../src/runtime/assistant/quality-qualification.js';
import {syncAssistantQualityContext as syncContext} from '../../electron/assistant-quality-workflow.js';
it('uses persistent assessment, live scopes and revocation', async () => {
    const s = setup();
    try {
        const pkg = await reviewed(s);
        expect((await s.service.import({ requestSource: 'user' })).status.state).toBe('passed');
        expect(readAssistantQualityAuthorization(s.db, readModel)?.assessmentId).toBe(pkg.assessmentId);
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeTruthy();
        s.db.prepare('UPDATE assistant_profiles SET data_scopes_json=?').run('["threads"]');
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
        s.service.revoke({ requestSource: 'user' });
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
    }
    finally {
        s.db.close();
    }
});
it('default denies nonusers and refuses forged flags, IDs and post-export model writes', async () => {
    const s = setup();
    try {
        await expect(s.service.freeze({ requestSource: 'agent' })).rejects.toThrow();
        const pkg = await reviewed(s);
        await expect(s.service.recordPredictions({ requestSource: 'user', assessmentId: pkg.assessmentId, expectedDigest: pkg.digest })).rejects.toThrow();
        const valid = s.file;
        s.file = JSON.stringify({ ...JSON.parse(valid), passed: true });
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        s.file = valid.replace('case-', 'fake-');
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        s.file = valid;
        s.deny();
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow('human');
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
it('reimports after explicit revoke with fresh attestation; old pending and capability never rebound', async () => {
    const s = setup();
    try {
        await reviewed(s);
        await s.service.import({ requestSource: 'user' });
        const old = readAssistantQualityAuthorization(s.db, readModel)!;
        expect(readAssistantQualityQualification(old.qualityQualification, old.currentBinding)).toBeTruthy();
        s.service.revoke({ requestSource: 'user' });
        expect(readAssistantQualityQualification(old.qualityQualification, old.currentBinding)).toBeUndefined();
        await s.service.import({ requestSource: 'user' });
        const next = readAssistantQualityAuthorization(s.db, readModel)!;
        expect(next.generation).toBeGreaterThan(old.generation);
        expect(next.digest).toBe(old.digest);
        expect(next.assessmentId).toBe(old.assessmentId);
        expect(readAssistantQualityAuthorization(s.db, readModel, old)).toBeUndefined();
        expect(readAssistantQualityQualification(old.qualityQualification, old.currentBinding)).toBeUndefined();
        const record = JSON.parse(String(s.db.prepare('SELECT payload_json FROM assistant_quality_assessments').get()!.payload_json));
        expect(record.attestation).toMatchObject({ provenance: 'user-attested', independentlyVerified: false, userId: 'local-user' });
        syncContext(s.db, { ...record.context, analysisContract: 'changed' });
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        syncContext(s.db, record.context);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
    }
    finally {
        s.db.close();
    }
});
it('blank export cannot pass and frozen protocol/prediction modifications are rejected', async () => {
    const s = setup({ predict: async (input) => input.cases.map(row => ({ id: row.id, prediction: 'unknown' })) });
    try {
        const f = await s.service.freeze({ requestSource: 'user' });
        await s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: f.digest });
        await s.service.export({ requestSource: 'user', assessmentId: f.assessmentId });
        const pkg = JSON.parse(s.file);
        expect(pkg.frozen.cases.every((r: any) => r.prediction === 'unknown')).toBe(true);
        const original = s.file;
        pkg.frozen.protocol.sampleSize = 10000;
        s.file = JSON.stringify(pkg);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        const changed = JSON.parse(original);
        changed.frozen.cases[0].prediction = 'needs_action';
        s.file = JSON.stringify(changed);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        s.file = original;
        expect((await s.service.import({ requestSource: 'user' })).status.state).toBe('failed');
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
it('rejects bounded imports and default-denies every user service operation', async () => {
    const s = setup();
    try {
        await reviewed(s);
        for (const requestSource of ['agent', 'scheduler', undefined] as any[]) {
            expect(() => s.service.status({ requestSource })).toThrow();
            expect(() => s.service.revoke({ requestSource })).toThrow();
            await expect(s.service.export({ requestSource, assessmentId: 'x' })).rejects.toThrow();
            await expect(s.service.import({ requestSource })).rejects.toThrow();
        }
        s.file = ' '.repeat(4000001);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow('size');
    }
    finally {
        s.db.close();
    }
});
it('reopens SQLite without cached authority and fails closed on persisted corruption', async () => {
    const s = setup(), dir = mkdtempSync(join(tmpdir(), 'quality-test-'));
    let reopened: DatabaseSync | undefined;
    try {
        await reviewed(s);
        await s.service.import({ requestSource: 'user' });
        const file = join(dir, 'quality.sqlite');
        const dest = new DatabaseSync(file);
        dest.exec(`CREATE TABLE assistant_profiles(id TEXT,status TEXT,data_scopes_json TEXT,updated_at INTEGER);INSERT INTO assistant_profiles VALUES('default-personal-assistant','active','["tasks"]',1)`);
        migrateAssistantQuality(dest);
        for (const table of ['assistant_quality_context', 'assistant_quality_state', 'assistant_quality_assessments']) {
            dest.exec(`DELETE FROM ${table}`);
            const rows = s.db.prepare(`SELECT * FROM ${table}`).all();
            for (const row of rows) {
                const values = Object.values(row);
                dest.prepare(`INSERT INTO ${table} VALUES(${values.map(() => '?').join(',')})`).run(...values);
            }
        }
        dest.close();
        reopened = new DatabaseSync(file);
        expect(readAssistantQualityAuthorization(reopened, readModel)).toBeTruthy();
        reopened.prepare('UPDATE assistant_quality_assessments SET payload_json=?').run('{}');
        expect(readAssistantQualityAuthorization(reopened, readModel)).toBeUndefined();
    }
    finally {
        reopened?.close();
        s.db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
it('requires a live model config reader; changed config rejects cached capability and cannot reattest', async () => {
    let identity = readModel();
    const s = setup({ readCurrentModel: () => identity });
    try {
        await reviewed(s);
        await s.service.import({ requestSource: 'user' });
        const auth = readAssistantQualityAuthorization(s.db, () => identity)!;
        expect(readAssistantQualityAuthorization(s.db)).toBeUndefined();
        identity = { ...identity, configFingerprint: 'd'.repeat(64) };
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
        expect(readAssistantQualityQualification(auth.qualityQualification, auth.currentBinding)).toBeUndefined();
        expect(s.service.status({ requestSource: 'user' }).state).toBe('stale');
        s.service.revoke({ requestSource: 'user' });
        identity = readModel();
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
    }
    finally {
        s.db.close();
    }
});
it('requires exact model sample coverage and unchanged frozen digest', async () => {
    const s = setup({ predict: async (input) => input.cases.map(r => ({ id: input.cases[0].id, prediction: 'wait' })) });
    try {
        const f = await s.service.freeze({ requestSource: 'user' });
        await expect(s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: '0'.repeat(64) })).rejects.toThrow();
        await expect(s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: f.digest })).rejects.toThrow('prediction_cases');
    }
    finally {
        s.db.close();
    }
});
it('attestation failure rolls back both assessment and authority', async () => {
    const s = setup({ confirmHumanReview: async () => ({ userId: '', text: 'invalid identity' }) });
    try {
        await reviewed(s);
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
        expect(s.service.status({ requestSource: 'user' }).state).toBe('review_required');
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
it('rejects model severe overrides and requires frozen main risk coverage', async () => {
    const s = setup({ predict: async (input) => input.cases.map(r => ({ id: r.id, prediction: 'needs_action', severe: false })) });
    try {
        const f = await s.service.freeze({ requestSource: 'user' });
        await expect(s.service.recordPredictions({ requestSource: 'user', assessmentId: f.assessmentId, expectedDigest: f.digest })).rejects.toThrow();
    }
    finally {
        s.db.close();
    }
    const missing = setup();
    try {
        await reviewed(missing);
        const row = missing.db.prepare('SELECT payload_json FROM assistant_quality_assessments').get()!;
        const record = JSON.parse(String(row.payload_json));
        record.facts[0].severe = null;
        const { frozenQualityDigest } = await import('../../../src/runtime/assistant/quality-authorization.js');
        record.digest = frozenQualityDigest(record);
        missing.db.prepare('UPDATE assistant_quality_assessments SET payload_json=?').run(JSON.stringify(record));
        const file = JSON.parse(missing.file);
        file.digest = record.digest;
        missing.file = JSON.stringify(file);
        expect((await missing.service.import({ requestSource: 'user' })).status.state).toBe('failed');
        expect(missing.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
    }
    finally {
        missing.db.close();
    }
});
it('revocation while native confirmation is pending cannot resurrect an in-flight import', async () => {
    let confirm!: () => void;
    const pending = new Promise<void>(resolve => { confirm = resolve; });
    const s = setup({ confirmHumanReview: async () => { await pending; return { userId: 'user', text: 'Reviewed by human' }; } });
    try {
        await reviewed(s);
        const importing = s.service.import({ requestSource: 'user' });
        await Promise.resolve();
        await Promise.resolve();
        s.service.revoke({ requestSource: 'user' });
        confirm();
        await expect(importing).rejects.toThrow('confirmation_stale');
        expect(s.service.readiness({ requestSource: 'user' }).qualityQualification).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
it('rejects extra renderer authority/path fields and permits revocation of corrupt assessment', async () => {
    const s = setup();
    try {
        await expect(s.service.freeze({ requestSource: 'user', path: '/tmp/forged' } as any)).rejects.toThrow();
        expect(() => s.service.status({ requestSource: 'user', qualified: true } as any)).toThrow();
        await reviewed(s);
        s.db.prepare('UPDATE assistant_quality_assessments SET payload_json=?').run('{}');
        expect(() => s.service.revoke({ requestSource: 'user' })).not.toThrow();
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
it('profile source epoch prevents pause/regrant with identical scopes from reusing qualification', async () => {
    const s = setup();
    try {
        await reviewed(s);
        await s.service.import({ requestSource: 'user' });
        const old = readAssistantQualityAuthorization(s.db, readModel)!;
        s.db.exec("UPDATE assistant_profiles SET status='paused',updated_at=2");
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
        s.db.exec("UPDATE assistant_profiles SET status='active',updated_at=3");
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
        expect(readAssistantQualityQualification(old.qualityQualification, old.currentBinding)).toBeUndefined();
        await expect(s.service.import({ requestSource: 'user' })).rejects.toThrow();
    }
    finally {
        s.db.close();
    }
});
it('missing durable human attestation cannot display or authorize a pass', async () => {
    const s = setup();
    try {
        await reviewed(s);
        await s.service.import({ requestSource: 'user' });
        const record = JSON.parse(String(s.db.prepare('SELECT payload_json FROM assistant_quality_assessments').get()!.payload_json));
        record.attestation = null;
        s.db.prepare('UPDATE assistant_quality_assessments SET payload_json=?').run(JSON.stringify(record));
        expect(s.service.status({ requestSource: 'user' }).state).toBe('unavailable');
        expect(readAssistantQualityAuthorization(s.db, readModel)).toBeUndefined();
    }
    finally {
        s.db.close();
    }
});
