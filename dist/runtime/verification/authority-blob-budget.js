import { readInstalledCapacityAuthority, claimInstalledCapacityLayer, finishInstalledCapacityLayer, failInstalledCapacityLayer } from './installed-controller.js';
import { createHash } from 'node:crypto';
import { createVerificationBlobBudget, assertVerificationBlobBudgetAuthority } from './blob-budget.js';
import { runVerificationTransaction, assertVerificationDatabaseBudget } from './storage-budget.js';
const authorityBudgets = new WeakMap();
export function assertAuthorityBlobBudgetAuthority(budget, authority) { if (authorityBudgets.get(budget) !== authority)
    throw Error('authority_pool_configuration'); assertVerificationBlobBudgetAuthority(budget, authority); }
export function readInstalledAuthorityBlobPool(authority) { const { database, authorityId } = readInstalledCapacityAuthority(authority), poolId = 'authority-' + createHash('sha256').update(authorityId).digest('hex'); const row = database.prepare('SELECT authority_id,pool_id FROM verification_authority_pool WHERE id=1').get(); if (!row || row.authority_id !== authorityId || row.pool_id !== poolId)
    throw Error('authority_pool_changed'); return Object.freeze({ database, authorityId, poolId }); }
/** The original installed authority pool; never selected by a request or profile DTO. */
export function createAuthorityBlobBudget(authority) {
    if (arguments.length !== 1)
        throw Error('capacity_authority_configuration');
    const { database: db, authorityId } = claimInstalledCapacityLayer(authority, 'authority-budget');
    try {
        if (typeof authorityId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(authorityId) || db.inTransaction)
            throw Error('authority_pool_configuration');
        const poolId = 'authority-' + createHash('sha256').update(authorityId).digest('hex');
        db.exec('CREATE TABLE IF NOT EXISTS verification_authority_pool(id INTEGER PRIMARY KEY CHECK(id=1),authority_id TEXT NOT NULL,pool_id TEXT NOT NULL)');
        runVerificationTransaction(db, () => {
            readInstalledCapacityAuthority(authority);
            const row = db.prepare('SELECT authority_id,pool_id FROM verification_authority_pool WHERE id=1').get();
            if (row && (row.authority_id !== authorityId || row.pool_id !== poolId))
                throw Error('authority_pool_changed');
            const hasReservations = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_blob_reservations'").get();
            if (hasReservations && db.prepare('SELECT 1 FROM verification_blob_reservations WHERE profile_id<>? LIMIT 1').get(poolId))
                throw Error('authority_pool_legacy_unknown');
            if (!row) {
                assertVerificationDatabaseBudget(db, { additionalBytes: 4096 });
                db.prepare('INSERT INTO verification_authority_pool VALUES(1,?,?)').run(authorityId, poolId);
            }
        });
        const budget = createVerificationBlobBudget(authority);
        authorityBudgets.set(budget, authority);
        finishInstalledCapacityLayer(authority, 'authority-budget', budget);
        return budget;
    }
    catch (error) {
        failInstalledCapacityLayer(authority, 'authority-budget');
        throw error;
    }
}
