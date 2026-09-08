export class CapabilityRegistry {
    records = new Map();
    register(record, owner = this) {
        const registrations = this.records.get(record.name) ?? new Map();
        // Refresh replaces this owner's entry rather than retaining old closures.
        registrations.delete(owner);
        registrations.set(owner, record);
        this.records.set(record.name, registrations);
    }
    unregister(name, owner) {
        if (!owner) {
            this.records.delete(name);
            return;
        }
        const registrations = this.records.get(name);
        registrations?.delete(owner);
        if (registrations?.size === 0)
            this.records.delete(name);
    }
    unregisterOwner(owner) {
        for (const [name, registrations] of this.records) {
            registrations.delete(owner);
            if (registrations.size === 0)
                this.records.delete(name);
        }
    }
    get(name) {
        const registrations = this.records.get(name);
        return registrations ? [...registrations.values()].at(-1) : undefined;
    }
    search(query) {
        const normalized = query.trim().toLowerCase();
        return [...this.records.keys()].map((name) => this.get(name)).filter((record) => {
            return !normalized
                || record.name.toLowerCase().includes(normalized)
                || record.description.toLowerCase().includes(normalized);
        });
    }
}
