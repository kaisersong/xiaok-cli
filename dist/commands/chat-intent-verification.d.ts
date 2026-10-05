import type { ValidationMaterialDraft } from '../runtime/verification/product-material-authorization.js';
export type IntentVerificationCommand = {
    kind: 'status' | 'cancel' | 'help';
} | {
    kind: 'reserve';
    path: string;
} | {
    kind: 'enroll' | 'run' | 'recover';
    id: string;
};
export declare const intentVerificationHelp = "/intent verify reserve <JSON\u6587\u4EF6>  \u56FA\u5B9A\u9A8C\u8BC1\u914D\u7F6E\u53CA\u8BF7\u6C42\u8EAB\u4EFD\n/intent verify enroll <\u8BB0\u5F55ID>      \u539F\u751F\u767B\u8BB0\u771F\u5B9E\u9A8C\u8BC1\u8C03\u7528\n/intent verify run <\u8BB0\u5F55ID>         \u539F\u751F\u6750\u6599\u6388\u6743\u540E\u6267\u884C\u539F\u72EC\u7ACB\u9A8C\u8BC1\n/intent verify recover <\u8BB0\u5F55ID>     \u53EA\u6062\u590D\u539F\u8BF7\u6C42\uFF0C\u4E0D\u91CD\u65B0\u6267\u884C\n/intent verify status               \u8BFB\u53D6\u5386\u53F2\u4E8B\u5B9E\uFF08\u4E0D\u662F\u4E1A\u52A1\u5B8C\u6210\uFF09\n/intent verify cancel               \u8BF7\u6C42\u4E2D\u65AD\u5F53\u524D\u64CD\u4F5C\uFF0C\u7B49\u5F85\u5B9E\u9645\u6392\u7A7A\nJSON\u5B8C\u6574\u5B57\u6BB5\uFF1AcandidateId\u3001obligationId\u3001exactCommand:{argv,cwdRelative}\u3001materials:[{path,byteLimit}]\u3001expiresAt\uFF08\u6BEB\u79D2\u65F6\u95F4\u6233\uFF0C\u81F3\u591A24\u5C0F\u65F6\uFF09\u3002\n\u6750\u6599path\u4E3A\u7528\u6237\u660E\u786E\u9009\u62E9\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF1Bcommand\u6765\u81EA\u7528\u6237\u539F\u72EC\u7ACB\u9A8C\u8BC1\u8BBE\u7F6E\uFF1B\u4E0D\u5F97\u628A\u9884\u671Fhash\u4ECE\u4EA7\u7269\u53CD\u63A8\u3002";
export declare function parseIntentVerificationCommand(input: string): IntentVerificationCommand | null;
/** Capture the explicit file envelope. The existing Store draft parser validates
 * all material/command fields with the actual newly allocated invocation. No
 * synthetic invocation or native approval is created by this reader. */
export declare function readIntentVerificationSelectionFile(path: string): Readonly<{
    candidateId: string;
    obligationId: string;
    exactCommand: ValidationMaterialDraft['exactCommand'];
    materials: ValidationMaterialDraft['materials'];
    expiresAt: number;
}>;
