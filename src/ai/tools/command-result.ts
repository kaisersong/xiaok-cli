import type {ToolExecutionFact} from '../../types.js';
/** Host-only facts; caller must bind tool and invocation before retaining one. Failure is sticky. */
export function retainCommandResult(previous:ToolExecutionFact|undefined,fact:ToolExecutionFact):ToolExecutionFact {
  return previous && previous.exitCode !== 0 ? previous : {...fact};
}
export function commandResultVerdict(fact:ToolExecutionFact|undefined):boolean|undefined {
  return fact?.toolName==='bash' && fact.factKind==='command_result' ? fact.exitCode===0 : undefined;
}
