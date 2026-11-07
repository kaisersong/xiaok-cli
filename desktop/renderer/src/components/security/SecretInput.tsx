import type {InputHTMLAttributes,Ref} from 'react';
/** Transient, masked input shared by settings and the task-bound secure card. */
export function SecretInput({ref,revealed=false,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>&{ref?:Ref<HTMLInputElement>;revealed?:boolean}){return <input {...props} ref={ref} type={revealed?'text':'password'} autoComplete="new-password" spellCheck={false} autoCapitalize="none" data-private="true"/>;}
