// Scope tripwire, not a SQL parser or a new authorization baseline. A new
// producer/call shape needs review; it cannot silently become an unguarded read.
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
it('all original supported Loop SQL mutations and constructor delegates use the owned lease paths',()=>{
 const four=['loop-store','completion-evidence-store','artifact-evidence-regression-loop','kswarm-health-loop'];
 let runs=0,execs=0,rollbacks=0,ownedMigrationExecs=0,migrationRollbacks=0,restores=0,delegates=0;
 for(const name of [...four,'loop-native-schema','loop-artifact-export-journal']){
  const source=ts.createSourceFile(name,readFileSync(new URL(`../../electron/${name}.ts`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node:ts.Node){
   if(ts.isCallExpression(node)){
    if(ts.isPropertyAccessExpression(node.expression)){
     const op=node.expression.name.text,receiver=node.expression.expression.getText(source);
     if(four.includes(name)){
      expect(['run','exec','iterate','bind'].includes(op),`${name}: raw SQL invocation ${node.getText(source)}`).toBe(false);
      if(op==='runWrite'){expect(receiver).toBe('this.connection');runs++;}
      if(op==='execWrite'){expect(receiver).toBe('this.connection');execs++;}
     }else{
      if(op==='execWrite'){expect(receiver).toBe('writer');ownedMigrationExecs++;}
      if(op==='rollbackOwned'){expect(receiver).toBe('writer');expect(node.arguments).toHaveLength(0);migrationRollbacks++;}
      if(op==='restoreForeignKeysOwned'){expect(receiver).toBe('writer');restores++;}
     }
    }
    if(ts.isIdentifier(node.expression)){
     const method=node.expression.text;
     if(method==='rollbackOriginalLoopDatabase'){expect(node.arguments.map(arg=>arg.getText(source))).toEqual(['this.connection','rollbackDatabase']);rollbacks++;}
     if(name==='loop-store'&&['migrateLoopNativeSchema','migrateLoopArtifactExportJournal'].includes(method)){expect(node.arguments.map(arg=>arg.getText(source))).toEqual(['this.db','this.connection']);delegates++;}
    }
   }
   if(four.includes(name)&&ts.isPropertyAccessExpression(node)&&node.name.text==='prepare'){
    expect(ts.isCallExpression(node.parent)).toBe(true);const call=node.parent;
    expect(ts.isPropertyAccessExpression(call.parent)&&['get','all'].includes(call.parent.name.text)).toBe(true);
   }
   ts.forEachChild(node,visit);
  }visit(source);
 }
 expect({runs,execs,rollbacks,ownedMigrationExecs,migrationRollbacks,restores,delegates}).toEqual({runs:85,execs:14,rollbacks:4,ownedMigrationExecs:6,migrationRollbacks:1,restores:1,delegates:2});
 // 105 forward calls, five exact ROLLBACK paths, one FK restoration. The
 // legacy raw-DB helper branch is deliberately not described as protected.
 expect(runs+execs+ownedMigrationExecs+rollbacks+migrationRollbacks+restores).toBe(111);
});
