import {parentPort,workerData} from 'node:worker_threads';
const signal=new Int32Array(workerData.signal);
parentPort.postMessage({ready:true});
Atomics.wait(signal,0,0);
workerData.buffer.grow(2);
Atomics.store(signal,1,1);Atomics.notify(signal,1);
