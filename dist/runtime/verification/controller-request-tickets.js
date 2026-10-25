import { randomBytes } from 'node:crypto';
/** Process-private monotonic one-use tickets. A new process has no old tickets. */
export function createControllerRequestTickets() {
    const tickets = new Map();
    function sweep() { const now = process.hrtime.bigint(); for (const [id, value] of tickets)
        if (value.expires <= now)
            tickets.delete(id); return now; }
    return Object.freeze({
        issue(principal) { const now = sweep(); if (tickets.size >= 4096 || [...tickets.values()].filter(v => v.principal === principal).length >= 64)
            throw Error('controller_ticket_capacity'); const id = randomBytes(32).toString('hex'); tickets.set(id, { principal, expires: now + 30000000000n }); return id; },
        consume(id, principal) { sweep(); if (typeof id !== 'string')
            throw Error('controller_ticket_unknown'); const value = tickets.get(id); if (!value || value.principal !== principal)
            throw Error('controller_ticket_unknown'); tickets.delete(id); },
    });
}
