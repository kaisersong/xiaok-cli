export function dshBudgetCommandDigest(purpose:string,input:unknown):string;
export function dshRecord(raw:unknown,names:readonly string[]):Record<string,unknown>;
export function parseDshInput(purpose:string,input:unknown):Readonly<Record<string,unknown>>;
export function parseDshAuthority(raw:unknown):Readonly<Record<string,unknown>>;
export function checkDshSource(purpose:string,authority:Readonly<Record<string,unknown>>):void;
export function dshInteger(value:unknown,min?:number,max?:number):number;
export function dshDigest(domain:string,value:unknown):string;
export function dshHash(value:unknown):string;
