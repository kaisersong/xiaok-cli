const definitive=new WeakSet<Error>();

/** A concrete original policy mismatch, unlike failure to obtain current proof. */
export function definitivePolicyDenial():Error{
 const error=new Error('not_readable');definitive.add(error);return error;
}
export function isDefinitivePolicyDenial(error:unknown):boolean{return error instanceof Error&&definitive.has(error);}
/** Preserve the public denial contract while retaining availability semantics
 * across recursive source checks. This error never authorizes a read. */
export class ContinuityPolicyUnavailable extends Error {
 readonly code='continuity_policy_unavailable';
 constructor(readonly reason:string,options?:ErrorOptions){super('not_readable',options);this.name='ContinuityPolicyUnavailable';}
}
