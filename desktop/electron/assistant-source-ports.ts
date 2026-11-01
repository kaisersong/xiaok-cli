/** Enumeration receipts, not authorization or publication capabilities. */
export interface AssistantSourceReceipt<T> {
 items: readonly T[];
 availability: 'available' | 'unavailable';
 completeness: 'complete' | 'partial' | 'unknown';
}
export type AssistantSourceRead<T> = readonly T[] | AssistantSourceReceipt<T>;
export function completeAssistantSource<T>(items: readonly T[]): AssistantSourceReceipt<T> {
 return {items,availability:'available',completeness:'complete'};
}
interface Project {id?:unknown;name?:unknown;updatedAt?:unknown;createdAt?:unknown;status?:unknown;summary?:unknown;workFolder?:unknown}
export async function readAssistantKSwarmProjects(
 service:{getStatus():{running:boolean;port?:number|null}},
 request: (url:string,init?:RequestInit)=>Promise<Pick<Response,'ok'|'json'>> = fetch,
):Promise<AssistantSourceReceipt<Project>> {
 const unavailable = ():AssistantSourceReceipt<Project>=>({items:[],availability:'unavailable',completeness:'unknown'});
 const status = service.getStatus();
 if(!status.running || !status.port)return unavailable();
 try {
  const response = await request(`http://127.0.0.1:${status.port}/projects`,{signal:AbortSignal.timeout(15_000)});
  if(!response.ok)return unavailable();
  const body:unknown = await response.json();
  if(!body || typeof body!=='object' || !Array.isArray((body as {projects?:unknown}).projects))return unavailable();
  const items=(body as {projects:Project[]}).projects;
  if(items.some(item=>!item || typeof item!=='object' || typeof item.id!=='string' || typeof item.name!=='string'))return unavailable();
  return completeAssistantSource(items);
 }catch{return unavailable();}
}
