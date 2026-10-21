export interface CompositeServiceRegistration {
    version: 1;
    kind: 'egress' | 'participant';
    authorityId: string;
    instanceEpoch: number;
    keyId: string;
    publicKeyPem: string;
    serviceUid: number;
    packageHash: string;
    controllerAuthorityId: string;
}
type Binding = {
    packageHash: string;
    controllerAuthorityId: string;
    forbiddenUids: readonly number[];
    forbiddenPublicKeys: readonly string[];
};
export declare function parseCompositeServiceRegistration(raw: unknown, kind: CompositeServiceRegistration['kind'], binding: Binding): Readonly<CompositeServiceRegistration>;
/** Both registrations are mandatory. A single valid file never activates either
 * service, and installation identity is not physical execution generation. */
export declare function parseCompositeServicePair(egress: unknown, participant: unknown, binding: Binding): Readonly<{
    egress: Readonly<CompositeServiceRegistration>;
    participant: Readonly<CompositeServiceRegistration>;
}>;
export {};
