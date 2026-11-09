export interface DecisionRuntimeObservation {implementation:'xiaok-local-text-v2';engine:'mlx-vlm'|'torch-eager'|null;device:'metal'|'mps'|'cpu'|'cuda'|null;parameterPrecision:'mixed-4bit-bf16'|'float32'|'float16'|'bfloat16'|null;quantization:'affine-4bit-group64'|'none'|null;versions:Record<string,string>;peakRssBytes:number|null;peakGpuAllocatedBytes:number|null}
export interface DecisionModelFile { name:string; size:number; hash:string; algorithm:'sha256'|'git-blob-sha1' }
export interface DecisionRuntimePackage {name:string;version:string;source:string;wheelSha256:string;files:Readonly<Record<string,string>>}
export interface DecisionModelManifest { id:string; repo:string; revision:string; runtime:'clef-mlx'|'laya'; files:readonly DecisionModelFile[];sizeBytes:number;source:string;platforms:readonly string[];codeHash:string|null;runtimePackage?:DecisionRuntimePackage }
export type DecisionModelState='not_installed'|'downloading'|'checking'|'interrupted'|'installed'|'loading'|'ready'|'failed';
export interface DecisionModelView {id:string;source:string;revision:string;sizeBytes:number;sizeLabel:string;supported:boolean;verified:boolean;state:DecisionModelState;reason:string|null;downloadedBytes:number;currentFile:string|null;availableDiskBytes:number|null;codeHash:string|null;runtime:'clef-mlx'|'laya';endpoint:string|null;runtimeSource?:string;runtimeVersion?:string;runtimePid?:number|null;runtimeInfo?:DecisionRuntimeObservation|null;selected:boolean;automaticMemoryRerank:'not-qualified-r12'}
export interface DecisionModelAction { modelId:string; approveCommunityCode?:boolean }

/** Requested user choice only. It does not activate the original experimental
 * memory read hook and confers no Source/Native execution permission. */
export interface DecisionModelSelection {
  version:1;
  modelId:string|null;
  revision:string|null;
  automaticMemoryRerank:'not-qualified-r12';
}
