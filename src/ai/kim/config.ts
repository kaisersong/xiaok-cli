import {randomUUID} from 'node:crypto';
import {z} from 'zod/v3';
import type {Config} from '../../types.js';
import {KIM_CONFIG_PATCH_SCHEMA,type KimConfigPatch,type KimConfigView} from './contracts.js';
export function canonicalKimOrigin(value:string):string {
 if(typeof value!=='string'||!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?\/?$/i.test(value))throw Error('kim_endpoint_invalid');
 const u=new URL(value);if(u.port==='0')throw Error('kim_endpoint_invalid');if(u.hostname==='localhost')u.hostname='127.0.0.1';return u.origin;
}
const stored=KIM_CONFIG_PATCH_SCHEMA.extend({revision:z.string().uuid().optional()});
export type ResolvedKimConfig=KimConfigView&{revision:string};
export function resolveKimDecisionConfig(config:Pick<Config,'kimDecision'>):ResolvedKimConfig {
 const s=stored.parse(config.kimDecision??{});return {enabled:s.enabled??false,baseUrl:canonicalKimOrigin(s.baseUrl??'http://127.0.0.1:8765'),attentionThreshold:s.attentionThreshold??0.65,revision:s.revision??'default'};
}
export function applyKimDecisionPatch(config:Config,input:KimConfigPatch):void {
 const p=KIM_CONFIG_PATCH_SCHEMA.parse(input);const previous=resolveKimDecisionConfig(config);config.kimDecision={...previous,...p,baseUrl:p.baseUrl===undefined?previous.baseUrl:canonicalKimOrigin(p.baseUrl),revision:randomUUID()};
}
export const kimConfigView=({enabled,baseUrl,attentionThreshold}:ResolvedKimConfig):KimConfigView=>({enabled,baseUrl,attentionThreshold});
