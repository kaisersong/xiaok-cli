import { z } from 'zod';
const id = z.string().min(1).max(2048),
  revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const mode = z.enum(['off', 'observe', 'auto_draft']);
const repository = z
  .object({
    owner: z.string().min(1).max(39),
    repo: z.string().min(1).max(100),
  })
  .strict();
const selection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('issue_ids'), issueIds: z.array(id) }).strict(),
  z
    .object({
      kind: z.literal('label_ids'),
      match: z.literal('all'),
      labelIds: z.array(id),
    })
    .strict(),
]);
export const DSH_SET_MODE = z.discriminatedUnion('scopeKind', [
  z
    .object({
      schemaVersion: z.literal(1),
      scopeKind: z.enum(['global', 'tenant', 'workspace', 'source_binding']),
      sourceBindingId: id.nullable(),
      tenantId: id.optional(),
      mode,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      scopeKind: z.literal('mandate'),
      sourceBindingId: id,
      mandateId: id,
      mode,
      expectedRevision: revision,
    })
    .strict(),
]);
export const DSH_CONFIGURE_SETUP = z
  .object({
    schemaVersion: z.literal(1),
    setupId: id,
    tenantId: id.optional(),
    candidateRepository: repository,
    selection,
    issueRefs: z.array(
      z
        .object({
          issueId: id,
          issueNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        })
        .strict(),
    ),
    minimumIntervalMs: z.number().int().min(1000).max(86400000),
    expectedRevision: revision,
  })
  .strict();
const connect = {
  schemaVersion: z.literal(1),
  configurationRevision: revision,
  operationId: id,
  secret: z.string().min(1).max(4096),
};
export const DSH_CONNECT = z.discriminatedUnion('kind', [
  z.object({ ...connect, kind: z.literal('setup'), setupId: id }).strict(),
  z
    .object({
      ...connect,
      kind: z.literal('source_binding'),
      sourceBindingId: id,
    })
    .strict(),
]);
export const DSH_SOURCE_ACTION = z
  .object({
    schemaVersion: z.literal(1),
    sourceBindingId: id,
    configurationRevision: revision,
  })
  .strict();
export const DSH_CONFIGURE_BUDGET = z
  .object({
    schemaVersion: z.literal(1),
    tenantId: id.optional(),
    mandateId: id,
    mandateRevision: revision,
    tokenLimit: revision,
    costLimitUsd: z.string().min(1).max(32),
    validUntil: id,
  })
  .strict();
export const DSH_PUBLISH_MANDATE = z
  .object({
    schemaVersion: z.literal(1),
    mandateId: id,
    sourceBindingId: id,
    expectedHeadRevision: revision,
    workProfile: z.literal('model_text_only_v1'),
    scopePolicyConsent: z.boolean(),
    allowedActorProviderIds: z.array(id).max(1000),
    allowedActions: z
      .array(
        z.enum([
          'source.read',
          'model.process_source',
          'local.draft.create',
          'local.draft.revise',
        ]),
      )
      .max(4),
    validUntil: id,
    maxInputBytes: revision,
    limits: z
      .object({
        maxActiveWorks: revision,
        maxDraftRunsPerWork: revision,
        maxTokens: revision,
        maxCostUsd: z.string().min(1).max(32),
        executionDeadline: id,
      })
      .strict(),
    dataEgressPolicyRef: id,
    followup: z
      .object({ enabled: z.boolean(), observationEndsAt: id })
      .strict(),
  })
  .strict();
export const DSH_PUBLISH_EGRESS_POLICY = z
  .object({
    schemaVersion: z.literal(1),
    sourceBindingId: id,
    mandateId: id,
    policyRef: id,
    provider: id,
    modelIds: z.array(id).max(16),
    destinationRef: id,
    purposes: z.array(z.enum(['admission', 'preview', 'draft'])).max(3),
    enabled: z.boolean(),
    validUntil: id,
    expectedRevision: revision,
  })
  .strict();
export const DSH_SETTINGS_STATE = z
  .object({
    schemaVersion: z.literal(1),
    availability: z.enum(['unavailable', 'ready', 'closing', 'unknown']),
    executionQualified: z.boolean(),
    domain: z
      .object({ revision, authorityEpoch: revision, state: id })
      .strict()
      .nullable(),
    modes: z.array(
      z
        .object({
          scopeKind: z.enum([
            'global',
            'tenant',
            'workspace',
            'source_binding',
            'mandate',
          ]),
          tenantId: id.optional(),
          sourceBindingId: id.nullable(),
          mandateId: id.optional(),
          mode,
          epoch: revision,
          revision,
          status: z.enum(['effective', 'accepted_pending_owner_fence']),
        })
        .strict(),
    ),
    setups: z.array(
      z
        .object({
          setupId: id,
          tenantId: id.optional(),
          configurationRevision: revision,
          candidateRepository: repository,
          selection,
          minimumIntervalMs: revision,
          mode: z.enum(['off', 'observe']),
        })
        .strict(),
    ),
    sources: z.array(
      z
        .object({
          sourceBindingId: id,
          tenantId: id.optional(),
          configurationRevision: revision,
          credentialEpoch: revision,
          repository: repository.extend({ repositoryId: id }).strict(),
          selection,
          minimumIntervalMs: revision,
          mode,
          connection: z.enum([
            'credential_required',
            'validating',
            'connected',
            'unknown',
            'closing',
            'closed',
          ]),
          lastScan: z
            .object({
              scanId: id,
              sourceSnapshotAt: id,
              pagination: z.enum(['complete', 'partial', 'unknown']),
              checkpointRevision: revision.nullable(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    authorizations: z
      .object({
        budgetAccountId: id.nullable(),
        mandates: z.array(
          z
            .object({
              mandateId: id,
              sourceBindingId: id,
              revision,
              headRevision: revision,
              status: id,
              validUntil: id,
            })
            .strict(),
        ),
        egressPolicyState: z.enum(['unknown', 'configured']),
        egressPolicies: z
          .array(
            z
              .object({
                policyRef: id,
                sourceBindingId: id,
                mandateId: id,
                provider: id,
                modelIds: z.array(id),
                destinationRef: id,
                purposes: z.array(z.enum(['admission', 'preview', 'draft'])),
                enabled: z.boolean(),
                validUntil: id,
                epoch: revision,
                revision,
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    lastErrorCode: z.string().max(256).nullable(),
  })
  .strict();
