import * as crypto from 'node:crypto';
export async function compactL0toL1(db, llm, options = {}) {
    const { sessionId, minMessages = 5, maxPromptTokens = 8000 } = options;
    let query = 'SELECT * FROM memory_l0_raw WHERE compacted = 0';
    const params = [];
    if (sessionId) {
        query += ' AND session_id = ?';
        params.push(sessionId);
    }
    query += ' ORDER BY created_at ASC';
    const messages = db.prepare(query).all(...params);
    if (messages.length < minMessages) {
        return { extracted: 0 };
    }
    const bySession = new Map();
    for (const msg of messages) {
        const list = bySession.get(msg.session_id) || [];
        list.push(msg);
        bySession.set(msg.session_id, list);
    }
    let totalExtracted = 0;
    for (const [sid, sessionMessages] of bySession) {
        if (sessionMessages.length < minMessages)
            continue;
        const maxChars = maxPromptTokens * 4;
        let messagesToProcess = sessionMessages;
        const fullConversation = sessionMessages
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');
        if (fullConversation.length > maxChars) {
            messagesToProcess = [];
            let accumulatedChars = 0;
            for (let i = sessionMessages.length - 1; i >= 0; i--) {
                const msgChars = sessionMessages[i].content.length + sessionMessages[i].role.length + 2;
                if (accumulatedChars + msgChars > maxChars)
                    break;
                messagesToProcess.unshift(sessionMessages[i]);
                accumulatedChars += msgChars;
            }
            if (messagesToProcess.length < minMessages) {
                continue;
            }
        }
        const conversation = messagesToProcess
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');
        const prompt = `从以下对话中提取关键记忆点。每个记忆点包含简短摘要和标签。

对话内容：
${conversation}

请以JSON格式输出：
{"summaries": [{"summary": "简短摘要", "tags": ["tag1", "tag2"]}]}

只输出JSON，不要其他内容。`;
        try {
            const response = await llm(prompt);
            const parsed = JSON.parse(response);
            const summaries = parsed.summaries || [];
            const insertStmt = db.prepare(`INSERT INTO memory_l1_extracted (id, source_ids, summary, tags) VALUES (?, ?, ?, ?)`);
            const processedIds = sessionMessages.map((m) => m.id);
            const sourceIds = JSON.stringify(processedIds);
            for (const s of summaries) {
                const id = crypto.randomUUID();
                insertStmt.run(id, sourceIds, s.summary, JSON.stringify(s.tags));
                totalExtracted++;
            }
            const markStmt = db.prepare('UPDATE memory_l0_raw SET compacted = 1 WHERE id = ?');
            for (const id of processedIds) {
                markStmt.run(id);
            }
        }
        catch (err) {
            console.error('[memory] L0→L1 compaction failed for session', sid, err.message);
        }
    }
    return { extracted: totalExtracted };
}
export async function compactL1toL2(db, llm) {
    const l1Rows = db.prepare('SELECT * FROM memory_l1_extracted ORDER BY created_at ASC').all();
    if (l1Rows.length < 3) {
        return { scenarios: 0 };
    }
    const maxPromptTokens = 8000;
    const summaries = l1Rows
        .map((r) => `- [${r.id}] ${r.summary} (tags: ${r.tags})`)
        .join('\n');
    const maxChars = maxPromptTokens * 4;
    const truncatedSummaries = summaries.length > maxChars
        ? summaries.slice(-maxChars)
        : summaries;
    const prompt = `将以下记忆摘要归纳为场景组。每个场景包含名称和关键事实。

记忆摘要：
${truncatedSummaries}

请以JSON格式输出：
{"scenarios": [{"scenario": "场景名称", "key_facts": ["事实1", "事实2"]}]}

只输出JSON，不要其他内容。`;
    try {
        const response = await llm(prompt);
        const parsed = JSON.parse(response);
        const scenarios = parsed.scenarios || [];
        const insertStmt = db.prepare(`INSERT INTO memory_l2_scenario (id, source_ids, scenario, key_facts) VALUES (?, ?, ?, ?)`);
        const sourceIds = JSON.stringify(l1Rows.map((r) => r.id));
        for (const s of scenarios) {
            const id = crypto.randomUUID();
            insertStmt.run(id, sourceIds, s.scenario, JSON.stringify(s.key_facts));
        }
        return { scenarios: scenarios.length };
    }
    catch (err) {
        console.error('[memory] L1→L2 compaction failed', err.message);
        return { scenarios: 0 };
    }
}
export async function compactL2toL3(db, llm) {
    const l2Rows = db.prepare('SELECT * FROM memory_l2_scenario ORDER BY created_at ASC').all();
    if (l2Rows.length < 2) {
        return { traits: 0 };
    }
    const maxPromptTokens = 8000;
    const scenarios = l2Rows
        .map((r) => `- [${r.id}] ${r.scenario}: ${r.key_facts}`)
        .join('\n');
    const maxChars = maxPromptTokens * 4;
    const truncatedScenarios = scenarios.length > maxChars
        ? scenarios.slice(-maxChars)
        : scenarios;
    const prompt = `从以下场景中提取用户的持久特征/偏好。每个特征包含描述、证据和置信度(0-1)。

场景：
${truncatedScenarios}

请以JSON格式输出：
{"traits": [{"trait": "特征描述", "evidence": ["证据1"], "confidence": 0.9}]}

只输出JSON，不要其他内容。`;
    try {
        const response = await llm(prompt);
        const parsed = JSON.parse(response);
        const traits = parsed.traits || [];
        for (const t of traits) {
            const existing = db.prepare('SELECT * FROM memory_l3_persona WHERE trait = ?').get(t.trait);
            if (existing) {
                const mergedEvidence = JSON.stringify([
                    ...JSON.parse(existing.evidence || '[]'),
                    ...t.evidence,
                ]);
                const newConfidence = Math.min(1.0, existing.confidence + (1 - existing.confidence) * t.confidence * 0.5);
                db.prepare(`UPDATE memory_l3_persona SET evidence = ?, confidence = ?, updated_at = datetime('now') WHERE id = ?`).run(mergedEvidence, newConfidence, existing.id);
            }
            else {
                const id = crypto.randomUUID();
                const sourceIds = JSON.stringify(l2Rows.map((r) => r.id));
                db.prepare(`INSERT INTO memory_l3_persona (id, source_ids, trait, evidence, confidence) VALUES (?, ?, ?, ?, ?)`).run(id, sourceIds, t.trait, JSON.stringify(t.evidence), t.confidence);
            }
        }
        return { traits: traits.length };
    }
    catch (err) {
        console.error('[memory] L2→L3 compaction failed', err.message);
        return { traits: 0 };
    }
}
