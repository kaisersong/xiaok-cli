import {parseLoopContractV1,type LoopContractV1} from '../loop/contract.js';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from './protocol.js';

function freeze<T>(value:T):T {
  if(value&&typeof value==='object'){
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Exact business description for native review. It grants no command, material
 * access or verification proof; legacy weak criteria stay weak. The ordinary
 * Desktop path continues to use the same underlying parser without this gate. */
export function parseStrictLoopContractV1(raw:unknown):Readonly<LoopContractV1> {
  const encoded=json(raw);
  if(Buffer.byteLength(encoded)>65536)throw Error('loop_contract_limit');
  const captured:unknown=JSON.parse(encoded);
  const parsed=parseLoopContractV1(captured,{registeredCriteria:['task_completed','file_exists','command_exit_zero']});
  // The legacy parser normalizes optional fields and ignores some nested extras.
  // A signed contract cannot silently lose any of its reviewed fields.
  if(json(parsed)!==encoded)throw Error('loop_contract_noncanonical');
  return freeze(parsed);
}

export const LOOP_DIAGNOSTIC_SCANNERS=['artifact-evidence-regression','kswarm-service-health'] as const;
export const LOOP_ASSISTANT_DATA_SCOPES=['threads','projects','tasks','artifacts','automations','meetings'] as const;
export type LoopBusinessContract =
  | {version:1;kind:'builtin-diagnostic';scanner:typeof LOOP_DIAGNOSTIC_SCANNERS[number];objective:string;completionCriterion:string}
  | {version:1;kind:'user-template';templateKind:'markdown_file'|'task_completion';prompt:string;outputDirectory:string;outputFileName:string;loopContract:Readonly<LoopContractV1>}
  | {version:1;kind:'assistant';assistantKind:'evening'|'morning';profileId:'default-personal-assistant';locale:'zh'|'en';timeZone:string;dataScopes:readonly (typeof LOOP_ASSISTANT_DATA_SCOPES[number])[];objective:string;completionCriterion:string};

function shape(value:unknown,keys:string[]):asserts value is Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('loop_contract_shape');
}
function text(value:unknown,allowEmpty=false):asserts value is string {
  if(typeof value!=='string'||(!allowEmpty&&!value.trim()))throw Error('loop_contract_text');
}

/** Complete producer business description only. Explicit recipes, OS permissions
 * and native approval are separate authorities. This parser never invents them.
 * The final native review also checks its whole ASCII-safe envelope size. */
export function parseLoopBusinessContract(raw:unknown):Readonly<LoopBusinessContract> {
  const encoded=json(raw);
  if(Buffer.byteLength(encoded)>65536)throw Error('loop_contract_limit');
  const captured:unknown=JSON.parse(encoded);
  if(!captured||typeof captured!=='object'||Array.isArray(captured)||!('kind' in captured))throw Error('loop_contract_shape');
  const value=captured as Record<string,unknown>;
  if(value.kind==='builtin-diagnostic'){
    shape(value,['version','kind','scanner','objective','completionCriterion']);
    if(!LOOP_DIAGNOSTIC_SCANNERS.includes(value.scanner as never))throw Error('loop_contract_scanner');
    text(value.objective);text(value.completionCriterion);
  }else if(value.kind==='user-template'){
    shape(value,['version','kind','templateKind','prompt','outputDirectory','outputFileName','loopContract']);
    if(value.templateKind!=='markdown_file'&&value.templateKind!=='task_completion')throw Error('loop_contract_template');
    text(value.prompt);text(value.outputDirectory,true);text(value.outputFileName,true);
    value.loopContract=parseStrictLoopContractV1(value.loopContract);
  }else if(value.kind==='assistant'){
    shape(value,['version','kind','assistantKind','profileId','locale','timeZone','dataScopes','objective','completionCriterion']);
    if(!['evening','morning'].includes(value.assistantKind as string)||value.profileId!=='default-personal-assistant'
      ||!['zh','en'].includes(value.locale as string))throw Error('loop_contract_assistant');
    text(value.timeZone);text(value.objective);text(value.completionCriterion);
    if(!Array.isArray(value.dataScopes)||value.dataScopes.some(v=>!LOOP_ASSISTANT_DATA_SCOPES.includes(v as never)))throw Error('loop_contract_data_scopes');
    // Preserve exact scope order and multiplicity from the stored profile. This
    // snapshot describes the candidate; it is not a current permission grant.
  }else throw Error('loop_contract_kind');
  if(value.version!==1)throw Error('loop_contract_version');
  return freeze(value) as Readonly<LoopBusinessContract>;
}

export function loopBusinessContractHash(raw:unknown):string {
  return createHash('sha256').update('xiaok-loop-business-contract-v1\0').update(json(parseLoopBusinessContract(raw))).digest('hex');
}
