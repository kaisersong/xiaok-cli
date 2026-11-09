'use strict';
// Fixed sibling resource only. Its shape never creates Native IO authority.
const native=require('./protected_sqlite.node'),adapter=require('./index.cjs');
const core=native.readOriginalBrokerSource();
const namespace=core===undefined?null:adapter.wrapOriginalProtectedSQLiteNamespace(core);
const apply=Reflect.apply,bind=native.bindOriginalBrokerNamespace,finish=native.finishOriginalBrokerSource,ErrorType=Error;
if(namespace){for(const fn of [namespace.Database,namespace.Statement,namespace.transactionStateGetter,namespace.closeOwned,...Object.values(namespace.databaseMethods),...Object.values(namespace.statementMethods)])Object.freeze(fn);}
function bindNamespace(){if(new.target||arguments.length)throw new ErrorType('broker_original_namespace_arguments');return apply(bind,native,[]);}
function closeSource(){if(new.target||arguments.length)throw new ErrorType('broker_original_finish_arguments');return apply(finish,native,[]);}
Object.freeze(bindNamespace);Object.freeze(closeSource);
module.exports=Object.freeze({namespace,bindNamespace,finish:closeSource});
