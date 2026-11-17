/** Local read-only DATA. These messages convey no execution or context ownership. */
export interface LocalLegacyTaskArchive {
 taskId:string;
 sourceEpoch:string;
 messages:ReadonlyArray<Readonly<{sourceMessageId:string;role:'assistant';text:string}>>;
}
