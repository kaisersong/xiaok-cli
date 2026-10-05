import {runDeploymentCommand} from './deployment-command.js';
try{runDeploymentCommand(process.argv.slice(2));}
catch{process.stderr.write('verification_deployment_command_failed\n');process.exitCode=1;}
