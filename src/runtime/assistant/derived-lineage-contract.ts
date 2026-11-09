import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(512),integer=z.number().nonnegative().refine(Number.isSafeInteger);
/** Plain bounded data. A parsed record or hash does not confer source authority. */
export const ASSISTANT_DERIVED_LINEAGE_SCHEMA=z.object({
 version:z.literal(1),profileId:id,profileRevision:hash,
 parents:z.array(z.object({runId:id,lineageHash:hash,external:z.boolean().optional()}).strict()).max(100),
 calendar:z.object({epoch:integer.refine(value=>value>0),observationRevision:hash,events:z.array(z.object({id:hash,observationRevision:hash}).strict()).max(20)}).strict().optional(),
 memory:z.object({ownerId:id,consentRevision:integer,records:z.array(z.object({id,contentHash:hash,candidateId:id,confirmationRevision:hash}).strict()).max(6)}).strict().optional(),
}).strict();
export type AssistantDerivedLineage=z.infer<typeof ASSISTANT_DERIVED_LINEAGE_SCHEMA>;
