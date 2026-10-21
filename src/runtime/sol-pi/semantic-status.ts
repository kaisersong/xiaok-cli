/** Display facts from the host owner. This DTO never conveys an authorization. */
export interface SemanticCompactionStatus {
 mode:'automatic'|'mechanism-experiment';
 state:'waiting'|'compacted'|'skipped'|'failed';
 reason?:'economics'|'changed'|'no-gain'|'budget'|'unavailable';
 attempts:number; maxAttempts:number; reservedCostUnits:number; maxCostUnits:number;
}
