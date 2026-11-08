const H = '12'.repeat(32), Z = '00'.repeat(32);
const hashFields = ['authorityIdHash', 'installationReleaseHash', 'mainHash', 'controllerPackageHash', 'profileHash', 'operationHash', 'namespaceId', 'birthId', 'poolId', 'wholeSourceNamespaceHash', 'finalReviewHash', 'nativeApprovalBindingHash', 'committedCommandHash', 'rootLedgerDigest', 'oldWriterFenceDigest', 'floorTransitionHash', 'clockDomainHash', 'historyBindingHash', 'policyDigest', 'pendingOperationHash', 'priorAcceptedHash', 'completeWitnessHash', 'bootSessionHash', 'publisherReleaseHash'];
export function mainRootEnrollmentCodecFixture() {
    const value: any = { version: 1, buildKind: 'component', uid: 0x01020304, epoch: '4294967298', accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555', mode: 'migration', clockEpoch: '1', notBefore: '1000', validUntil: '2000', sourceRootSchemaVersion: 3, targetRootSchemaVersion: 4, inventoryGeneration: '7', sourceFacts: [{ device: '4294967298', inode: '3', uid: 0x01020304, mode: 0o40700, nlink: '2' }, { device: '1', inode: '4', uid: 0x01020304, mode: 0o100600, nlink: '1' }, { device: '1', inode: '5', uid: 0x01020304, mode: 0o100600, nlink: '1' }], families: [] };
    for (let i = 0; i < hashFields.length; i++)
        value[hashFields[i]!] = (i + 1).toString(16).padStart(2, '0').repeat(32);
    value.priorAcceptedHash = Z;
    for (let i = 0; i < 4; i++)
        value.families.push({ family: ['admission', 'budget', 'kswarm', 'broker'][i], scopeRule: i + 1, readerVersion: 1, mode: 'migration', producerCodeDigest: H, namespaceBinding: H, ledgerDigest: H, captureManifestDigest: H, floorDigest: H, writerFenceDigest: H, derivedScope: H });
    return value;
}
