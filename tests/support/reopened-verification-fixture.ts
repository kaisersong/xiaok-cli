import type {KeyObject} from 'node:crypto';
import {installedControllerFixture} from './installed-controller-fixture.js';
/** Actual DB reopen through original installed start; no new native approval or
 * engine creation is allowed by the explicit test OS/engine leaf. */
export async function reopenedVerificationFixture(root:string,keys:{publicKey:KeyObject;privateKey:KeyObject}){
 return installedControllerFixture({existingRoot:root,expectedReceiverKeys:keys,recoveryOnly:true});
}
