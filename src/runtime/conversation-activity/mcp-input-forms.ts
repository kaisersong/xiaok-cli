import {createHash} from 'node:crypto';
import {z} from 'zod/v3';
import type {McpInputForm} from './types.js';

const key=z.string().min(1).max(256);
const options=z.array(z.string().max(4096)).min(1).max(128).refine(values=>new Set(values).size===values.length);
const field=z.object({title:z.string().optional(),type:z.enum(['string','integer','number','boolean','array']),enum:options.optional(),
 items:z.object({type:z.literal('string').optional(),enum:options}).passthrough().optional()}).passthrough().superRefine((value,context)=>{
 if(value.type==='array'&&!value.items||value.enum&&value.type!=='string'||value.items&&value.type!=='array')context.addIssue({code:z.ZodIssueCode.custom,message:'unsupported_field'});
});
const request=z.object({method:z.literal('elicitation/create'),params:z.object({message:z.string().optional(),mode:z.literal('form').optional(),
 requestedSchema:z.object({type:z.literal('object'),properties:z.record(key,field).refine(value=>Object.keys(value).length<=32),required:z.array(key).max(32).optional()}).passthrough()
}).passthrough()}).passthrough();
const requests=z.record(key,request).refine(value=>Object.keys(value).length>=1&&Object.keys(value).length<=32);
export const canonicalMcpInput=(value:unknown):unknown=>Array.isArray(value)?value.map(canonicalMcpInput)
 :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonicalMcpInput(item)])):value;

/** Complete representable forms only. Bounds admit an already read snapshot;
 * they are not a transport pre-read limit or an authorization proof. */
export function parseMcpInputForms(raw:unknown):McpInputForm[]{
 try{
  if(Buffer.byteLength(JSON.stringify(raw)??'')>256*1024)throw Error('capacity');
  const parsed=requests.parse(raw);
  if(Object.keys(parsed).length!==Object.keys(raw as object).length)throw Error('unsupported_key');
  return Object.entries(parsed).map(([inputId,item])=>{
   const original=(raw as Record<string,unknown>)[inputId];
   if(Buffer.byteLength(JSON.stringify(original))>64*1024)throw Error('capacity');
   const schema=item.params.requestedSchema;
   const originalSchema=(original as {params:{requestedSchema:{properties:object}}}).params.requestedSchema;
   // Closed structural vocabulary: constraints remain in the original schema
   // for Ajv, but no $ref/composition/patternProperties may hide extra fields.
   const objectKeys=new Set(['type','properties','required','additionalProperties','title','description','$schema']);
   if(Object.keys(originalSchema).some(key=>!objectKeys.has(key))
    ||'additionalProperties' in originalSchema&&typeof originalSchema.additionalProperties!=='boolean')throw Error('unsupported_structure');
   if(Object.keys(schema.properties).length!==Object.keys(originalSchema.properties).length)throw Error('unsupported_key');
   const fieldKeys=new Set(['type','title','description','enum','items','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','format','default','minItems','maxItems','uniqueItems']);
   const itemKeys=new Set(['type','enum','title','description','minLength','maxLength','pattern','format']);
   for(const value of Object.values(schema.properties)){
    if(Object.keys(value).some(key=>!fieldKeys.has(key))||value.items&&Object.keys(value.items).some(key=>!itemKeys.has(key)))throw Error('unsupported_structure');
   }
   if(schema.required?.some(key=>!Object.hasOwn(schema.properties,key)))throw Error('unsupported_required');
   return {inputId,expectedDigest:createHash('sha256').update(JSON.stringify(canonicalMcpInput(original))).digest('hex'),prompt:(item.params.message??'').slice(0,1024),
    fields:Object.entries(schema.properties).map(([key,value])=>({key,title:(value.title??key).slice(0,256),required:schema.required?.includes(key)??false,
     type:value.type==='boolean'?'boolean':value.type==='integer'||value.type==='number'?'number':value.type==='array'?'choices':value.enum?'choice':'text',
     ...(value.enum||value.items?{options:value.enum??value.items!.enum}:{})}))};
  });
 }catch(cause){throw new Error('activity_mcp_input_unavailable',{cause});}
}
