'use strict';
// Installed fixed sibling module only. No runtime resolver/installer is accepted.
const native=require('./protected_sqlite.node');
const adapter=require('./index.cjs');
const core=native.readOriginalKSwarmSource();
const api=core===undefined?null:adapter.wrapOriginalProtectedSQLiteNamespace(core);
const apply=Reflect.apply,bind=native.bindOriginalKSwarmNamespace,finish=native.finishOriginalKSwarmSource;
if(api){for(const fn of [api.Database,api.Statement,api.transactionStateGetter,api.closeOwned,...Object.values(api.databaseMethods),...Object.values(api.statementMethods)])Object.freeze(fn);}
const value=Object.freeze({namespace:api,bindNamespace(){return apply(bind,native,[]);},finish(){return apply(finish,native,[]);}});
Object.freeze(value.bindNamespace);Object.freeze(value.finish);module.exports=value;
