export function createDshBudgetTransaction(db:{exec(sql:string):unknown},onUnknown:(error:Error & {outcomeUnknown?:boolean})=>void):<T>(action:()=>T)=>T;
