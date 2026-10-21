import {it,expect} from 'vitest';import {randomUUID} from 'node:crypto';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';import {buildDockerWorkerRequest} from '../../../src/runtime/isolated-execution/docker-request.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('actual dev Docker captures stdout/stderr from attach-before-start through EOF and independent terminal inspect',async()=>{
 const engine=new DockerEngineTransport({socketPath:socket!}),created=await engine.create(buildDockerWorkerRequest({imageDigest:image!,attemptId:'attach-'+randomUUID(),scopeDigest:'a'.repeat(64),argv:['/bin/sh','-c',"printf 'first output'; printf 'original error' >&2"]}));
 let capture:Awaited<ReturnType<typeof engine.attachOutput>>|undefined;
 try{capture=await engine.attachOutput(created.Id,{timeoutMs:10000});await engine.start(created.Id);await engine.wait(created.Id);const actual=await engine.inspect(created.Id);expect(actual.State).toMatchObject({Running:false,Pid:0,Status:'exited',ExitCode:0});const out=await capture.completed;expect(out).toMatchObject({complete:true,truncated:false});expect(out.stdout.toString()).toBe('first output');expect(out.stderr.toString()).toBe('original error');}
 finally{capture?.cancel();const state=await engine.inspect(created.Id);if(state.State.Running){await engine.kill(created.Id);await engine.wait(created.Id);}await engine.remove(created.Id);}
},20000);
