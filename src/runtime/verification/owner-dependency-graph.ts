import type {Database} from 'better-sqlite3';
/** Private same-database graph; serialized edges confer no authority. */
export function createOwnerDependencyGraph(db:Database){
 db.exec('CREATE TABLE IF NOT EXISTS verification_owner_dependencies(parent_key TEXT NOT NULL,child_key TEXT NOT NULL,PRIMARY KEY(parent_key,child_key));CREATE INDEX IF NOT EXISTS verification_dependency_children ON verification_owner_dependencies(child_key,parent_key);');
 function walk(key:string,reverse=false):string[]{
  const profile=JSON.parse(key).profileId,visited=new Map<string,number>(),visiting=new Set<string>();
  const query=db.prepare(reverse?'SELECT parent_key AS next FROM verification_owner_dependencies WHERE child_key=? ORDER BY parent_key LIMIT 4097':'SELECT child_key AS next FROM verification_owner_dependencies WHERE parent_key=? ORDER BY child_key LIMIT 4097');
  function visit(current:string,depth:number):number{
   if(depth>16)throw Error('verification_graph_depth');
   if(visiting.has(current))throw Error('verification_graph_cycle');
   const old=visited.get(current);if(old!==undefined){if(depth+old>16)throw Error('verification_graph_depth');return old;}
   if(visited.size+visiting.size>=4096)throw Error('verification_graph_capacity');
   if(JSON.parse(current).profileId!==profile||!db.prepare('SELECT 1 FROM verification_owners WHERE owner_key=?').get(current))throw Error('verification_graph_source');
   visiting.add(current);let height=0;
   const edges=query.all(current) as {next:string}[];if(edges.length>4096)throw Error('verification_graph_capacity');
   for(const row of edges)height=Math.max(height,1+visit(row.next,depth+1));
   visiting.delete(current);visited.set(current,height);return height;
  }
  visit(key,0);return [...visited.keys()].sort();
 }
 return Object.freeze({descendants:(key:string)=>walk(key),ancestors:(key:string)=>walk(key,true)});
}
