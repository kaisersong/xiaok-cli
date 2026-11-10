const secretKey=/^(?:.*ApiKey|apiKey|password|secret|token|accessToken|refreshToken|accessKey|appKey|appSecret|clientSecret|webhookUrl)$/i;
export function isSensitiveCredentialPath(path:string[]){return secretKey.test(path.at(-1)??'')||path.length>=4&&path[0]==='providers'&&path[2]==='headers';}
/** Main-only callers use this to validate answers; never return this list in a DTO. */
export function configuredCredentialValues(value:unknown,path:string[]=[]):string[]{if(!value||typeof value!=='object')return [];return Object.entries(value).flatMap(([k,v])=>typeof v==='string'&&isSensitiveCredentialPath([...path,k])?[v]:configuredCredentialValues(v,[...path,k]));}
