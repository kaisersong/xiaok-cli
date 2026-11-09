import {z} from 'zod/v3';
const key=z.string().min(1).max(256),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeActivityQuestionFormSchema=z.object({questionRef:key,questionId:z.string().uuid(),expectedDigest:digest,sourceRevision:z.number().int().positive().safe(),prompt:z.string().max(16000),choices:z.tuple([z.literal('approve'),z.literal('deny')])}).strict();
export const nativeActivityQuestionFormsSchema=z.array(nativeActivityQuestionFormSchema).max(32).superRefine((forms,context)=>{if(new Set(forms.map(form=>form.questionRef)).size!==forms.length||new Set(forms.map(form=>form.questionId)).size!==forms.length)context.addIssue({code:z.ZodIssueCode.custom,message:'native_question_inventory_conflict'});});
export type NativeActivityQuestionForm=z.infer<typeof nativeActivityQuestionFormSchema>;
export interface NativeActivityAnswer {questionRef:string;expectedDigest:string;choiceId:'approve'|'deny'}
