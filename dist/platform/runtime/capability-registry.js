export class CapabilityRegistry {
    records = new Map();
    register(record) {
        this.records.set(record.name, record);
    }
    unregister(name) {
        this.records.delete(name);
    }
    get(name) {
        return this.records.get(name);
    }
    search(query) {
        const normalized = query.trim().toLowerCase();
        return [...this.records.values()].filter((record) => {
            return !normalized
                || record.name.toLowerCase().includes(normalized)
                || record.description.toLowerCase().includes(normalized);
        });
    }
}
