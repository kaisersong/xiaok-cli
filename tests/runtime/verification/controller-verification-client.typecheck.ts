import {createInstalledVerificationClient} from '../../../src/runtime/verification/controller-client.js';
declare const client:ReturnType<typeof createInstalledVerificationClient>;
void client.verificationTransport.call('verification.prepare',{});
void client.verificationTransport.call('verification.dispatch',{});
// @ts-expect-error Private issuer methods are not part of this transport.
void client.verificationTransport.call('verification.issue-proof',{});

void client.publicationTransport.call('publication.prepare',{});
void client.publicationTransport.call('publication.approve',{});
void client.publicationTransport.call('publication.reconcile',{});
// @ts-expect-error private grant issuance is never a public method
void client.publicationTransport.call('publication.issue-grant',{});

void client.publicationTransport.call('publication.recoverExpired',{});

void client.publicationTransport.call('publication.observeOwner',{});
