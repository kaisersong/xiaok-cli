import { realpathSync } from 'node:fs';
import { assertSessionExecutionLease } from './execution-authority.js';
const chains = new WeakMap();
const activeAncestors = new WeakMap();
/** Inspect only this exact currently held chain. A JSON path, another chain
 * over the same IDs, or a released/copied lease cannot authorize an ancestor
 * exception in the canonical tree census. */
export function getHeldSessionExecutionChainPath(chain, childLease) {
    const entries = chains.get(chain), held = activeAncestors.get(childLease);
    if (!entries || !held || entries.length !== held.length || entries.some((entry, index) => entry.target !== held[index].target))
        throw Error('session_execution_chain_not_held');
    childLease.assertCurrent();
    for (const entry of held)
        assertSessionExecutionLease(entry.lease, entry.target);
    return Object.freeze(entries.map(entry => Object.freeze({ root: entry.target.root, sessionIdentity: entry.target.sessionIdentity })));
}
/** Retrieve an already-held ancestor for root budget CAS. Never acquires a
 * second lock and never treats a copied lease or caller-supplied ID as proof. */
export function getSessionExecutionAncestorLease(childLease, target) {
    const entry = activeAncestors.get(childLease)?.find(row => row.target.root === realpathSync(target.root) && row.target.sessionIdentity === target.sessionIdentity);
    if (!entry)
        throw Error('session_execution_ancestor_not_held');
    childLease.assertCurrent();
    assertSessionExecutionLease(entry.lease, entry.target);
    return entry.lease;
}
/** Extend only an existing host chain, preserving oldest-ancestor-first order.
 * validate reads exact durable admission while this ancestor's real lease is held.
 * It must not perform user approval, dispatch physical effects or acquire children. */
export function createSessionExecutionChain(input) {
    const parent = input.parent ? chains.get(input.parent) : [];
    if (!parent || parent.length >= 16)
        throw Error('invalid_session_execution_ancestry');
    const target = Object.freeze({ ...input.target, root: realpathSync(input.target.root) });
    if (parent.some(entry => entry.target.root === target.root && entry.target.sessionIdentity.toLowerCase() === target.sessionIdentity.toLowerCase()))
        throw Error('duplicate_session_execution_ancestor');
    const chain = Object.freeze({ opaqueSessionExecutionChain: true });
    chains.set(chain, Object.freeze([...parent, Object.freeze({ target, validate: input.validate, validatePublication: input.validatePublication })]));
    return chain;
}
export function assertSessionExecutionChainLeaf(chain, target) {
    const leaf = chains.get(chain)?.at(-1);
    if (!leaf || leaf.target.authority !== target.authority || leaf.target.sessionIdentity !== target.sessionIdentity)
        throw Error('session_execution_chain_leaf_mismatch');
}
export function assertSessionExecutionChainRoot(chain, target) {
    const root = chains.get(chain)?.[0];
    if (!root || root.target.authority !== target.authority || root.target.sessionIdentity !== target.sessionIdentity)
        throw Error('session_execution_chain_root_mismatch');
}
export function assertSessionExecutionChainParents(chain, parents) {
    const entries = chains.get(chain);
    if (!entries || parents.length !== entries.length - 1 || parents.some((parent, index) => entries[index].target.root !== realpathSync(parent.root) || entries[index].target.sessionIdentity !== parent.sessionIdentity))
        throw Error('session_execution_chain_parent_mismatch');
}
async function releaseAll(held) {
    let failed = false, first;
    for (const lease of [...held].reverse())
        try {
            await lease.releaseAfterDrain();
        }
        catch (error) {
            if (!failed) {
                failed = true;
                first = error;
            }
        }
    if (failed)
        throw first;
}
/** Only effects use this scope. SDK/UI/whole-child waits must stay outside it. */
export async function acquireSessionExecutionChain(chain, input) {
    return acquireChain(chain, input, true);
}
/** Host-only factual finalization after revocation. Mutual exclusion is not
 * execution authority: consumers must expose only exact previously issued
 * terminal-fact ports and must never dispatch tools with this scope. */
export async function acquireSessionExecutionFactChain(chain, input) {
    return acquireChain(chain, { ...input, kind: 'recovery' }, false);
}
/** Actual coordinator publication only; the original chain fixes validators. */
export function acquireSessionPublicationChain(chain, input) { return acquireChain(chain, { ...input, kind: 'recovery' }, 'publication'); }
async function acquireChain(chain, input, validateExecution) {
    const entries = chains.get(chain);
    if (!entries?.length)
        throw Error('invalid_session_execution_ancestry');
    const held = [];
    try {
        for (const entry of entries) {
            input.signal?.throwIfAborted();
            const lease = await entry.target.authority.acquire(input);
            held.push(lease);
            assertSessionExecutionLease(lease, entry.target);
            if (validateExecution === 'publication')
                await (entry.validatePublication ?? entry.validate)?.(lease);
            else if (validateExecution)
                await entry.validate?.(lease);
            for (const prior of held)
                prior.assertCurrent();
        }
    }
    catch (error) {
        try {
            await releaseAll(held);
        }
        catch { /* Preserve the admission failure, after attempting every release. */ }
        throw error;
    }
    const childLease = held[held.length - 1];
    activeAncestors.set(childLease, Object.freeze(entries.map((entry, index) => Object.freeze({ target: entry.target, lease: held[index] }))));
    let release;
    return Object.freeze({
        childLease,
        assertCurrent() { if (release)
            throw Error('session_execution_chain_released'); for (const lease of held)
            lease.assertCurrent(); },
        trackInFlight(work) { if (release)
            throw Error('session_execution_chain_released'); for (const lease of held)
            lease.assertCurrent(); for (const lease of held)
            lease.trackInFlight(work); return work; },
        releaseAfterDrain() { return release ??= (async () => { try {
            await releaseAll(held);
        }
        finally {
            activeAncestors.delete(childLease);
        } })(); },
    });
}
