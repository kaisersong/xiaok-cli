import {it,expect} from 'vitest';import {randomUUID,createHash} from 'node:crypto';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import {buildDockerStdinWorkerRequest} from '../../../src/runtime/isolated-execution/docker-request.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('actual dev Docker accepts binary stdin then half-closes without losing delayed stdout/stderr',async()=>{
 const input=Buffer.concat([Buffer.from('original\0stdin\n'),Buffer.alloc(128*1024,65)]),engine=new DockerEngineTransport({socketPath:socket!}),{Id:id}=await engine.create(buildDockerStdinWorkerRequest({request:{imageDigest:image!,attemptId:'stdin-'+randomUUID(),scopeDigest:'a'.repeat(64),argv:['/bin/sh','-c','cat; sleep 0.05; printf eof; printf original-error >&2']},stdin:{sha256:createHash('sha256').update(input).digest('hex'),bytes:input.length}}));let capture:Awaited<ReturnType<typeof engine.attachOutput>>|undefined;
 try{capture=await engine.attachOutput(id,{timeoutMs:2500,stdin:input});await engine.start(id);const output=await capture.completed;expect(output).toMatchObject({complete:true,truncated:false});await engine.wait(id);expect((await engine.inspect(id)).State).toMatchObject({Status:'exited',ExitCode:0,Running:false,Pid:0});expect(output.stdout).toEqual(Buffer.concat([input,Buffer.from('eof')]));expect(output.stderr.toString()).toBe('original-error');}
 finally{capture?.cancel();const state=await engine.inspect(id);if(state.State.Running){await engine.kill(id);await engine.wait(id);}await engine.remove(id);}
},15000);
