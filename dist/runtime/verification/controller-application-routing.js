import { captureApplicationData } from './application-value-data.js';
import { APPLICATION_METHODS } from './application-transport.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Fixed installed application routing. Observations and recovery use the same
 * lifecycle gate; only authorize can enter the original native authority. */
export function createControllerApplicationRouting(input) {
    const current = input.assertCurrent.bind(input), renew = input.renew.bind(input);
    const application = input.application;
    const methods = {
        'application.prepare': application.prepare.bind(application),
        'application.prepareRequest': application.prepareRequest.bind(application),
        'application.lookupRequest': application.lookupRequest.bind(application),
        'application.recoverRequest': application.recoverRequest.bind(application),
        'application.authorize': application.authorize.bind(application),
        'application.inspect': application.inspect.bind(application),
        'application.reconcile': application.reconcile.bind(application),
    };
    return Object.freeze({
        async invoke(method, payload, peer, signal) {
            if (!APPLICATION_METHODS.includes(method))
                throw Error('installed_application_method');
            const originalPayload = JSON.parse(json(captureApplicationData(payload, { maximumBytes: 1048576, maximumNodes: 1048576, invalid: 'installed_application_data', limit: 'installed_application_limit' }))), originalPeer = structuredClone(peer);
            signal.throwIfAborted();
            current();
            await renew(signal);
            signal.throwIfAborted();
            current();
            if (method === 'application.authorize')
                return methods[method](originalPayload, originalPeer, signal);
            // Each actual authority method performs its own exact schema/source check.
            const execute = methods[method];
            return execute(originalPayload, originalPeer);
        },
    });
}
