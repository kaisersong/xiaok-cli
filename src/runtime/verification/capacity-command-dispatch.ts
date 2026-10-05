import {inspectQualificationPrepareCommand,executeQualificationPrepareCommand} from './installed-engine-qualification.js';
import type {Database} from 'better-sqlite3';
import type {CapacityWriteContext,PreparedCapacityCommandFacts} from './capacity-command.js';
import {inspectTranscriptPrepareCommand,executeTranscriptPrepareCommand} from './execution-transcripts.js';
import {inspectRunPrepareCommand,executeRunPrepareCommand} from './protected-run-ledger.js';
import {inspectStagingPrepareCommand,executeStagingPrepareCommand} from '../isolated-execution/broker-staging.js';
import {inspectDockerPrepareCommand,executeDockerPrepareCommand} from '../isolated-execution/docker-runner.js';
import {inspectArtifactPrepareCommand,executeArtifactPrepareCommand} from '../isolated-execution/artifact-export.js';

/** Closed, compiled dispatch. Adding a producer requires its original private
 * issuer and a fixed handler; callers cannot register handlers or SQL. */
export function inspectPreparedCapacityCommand(command:object,budget:object,database:Database):Readonly<PreparedCapacityCommandFacts & {issuerFamily:'transcript'|'run'|'material'|'raw'|'qualification-probe'|'artifact-batch'}>{
 const transcript=inspectTranscriptPrepareCommand(command,budget,database);
 if(transcript)return Object.freeze({...transcript,issuerFamily:'transcript' as const});
 const run=inspectRunPrepareCommand(command,budget,database);if(run)return Object.freeze({...run,issuerFamily:'run' as const});
 const staging=inspectStagingPrepareCommand(command,budget,database);if(staging)return Object.freeze({...staging,issuerFamily:'material' as const});
 const docker=inspectDockerPrepareCommand(command,budget,database);if(docker)return Object.freeze({...docker,issuerFamily:'raw' as const});
 const qualification=inspectQualificationPrepareCommand(command,budget,database);if(qualification)return Object.freeze({...qualification,issuerFamily:'qualification-probe' as const});
 const artifact=inspectArtifactPrepareCommand(command,budget,database);if(artifact)return Object.freeze({...artifact,issuerFamily:'artifact-batch' as const});
 throw Error('capacity_command_brand');
}
export function executePreparedCapacityCommand(command:object,context:CapacityWriteContext):void{
 if(executeTranscriptPrepareCommand(command,context))return;
 if(executeRunPrepareCommand(command,context))return;
 if(executeStagingPrepareCommand(command,context))return;
 if(executeDockerPrepareCommand(command,context))return;
 if(executeQualificationPrepareCommand(command,context))return;
 if(executeArtifactPrepareCommand(command,context))return;
 throw Error('capacity_command_brand');
}
