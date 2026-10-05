import {attachDockerOutput,type AttachedOutputCapture} from './docker-attached-output.js';
import { request, type IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';
import { buildDockerStdinWorkerRequest, buildDockerWorkerRequest, assertDockerImageConfiguration } from './docker-request.js';
import { buildDockerVolumeRequest, buildDockerMountedRequest, type VolumeProposal } from './docker-volume-request.js';
import { buildInputFileArchive } from './input-tar.js';

/** Fixed local IPC transport. Its existence is not a qualified engine binding. No env/context fallback. */
export class DockerEngineTransport {
  private readonly socketPath: string;
  constructor(options: { socketPath: string }) {
    const path = options.socketPath;
    if (typeof path !== 'string' || path.includes('\0') || !(isAbsolute(path) || (process.platform === 'win32' && /^\\\\\.\\pipe\\[A-Za-z0-9_.-]+$/.test(path)))) throw Error('docker_engine_endpoint');
    this.socketPath = path;
  }
  private async call(method: string, path: string, body?: unknown, binary = false, timeoutMs = 15000, signal?: AbortSignal, maximumResponseBytes = 4 * 1024 ** 2, returnHeaders = false): Promise<any> {
    const expiresAt = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
    const rawArchive = Buffer.isBuffer(body);
    const bytes = body === undefined ? undefined : rawArchive ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
    if (bytes && bytes.length > (rawArchive ? 17 * 1024 ** 2 : 1024 ** 2)) throw Error('docker_engine_request_limit');
    return new Promise((resolve, reject) => {
      let settled = false;
      let response: IncomingMessage | undefined;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        // Timer callbacks can be delayed behind parsing or other synchronous event-loop work.
        if (!error && process.hrtime.bigint() >= expiresAt) error = Error('docker_engine_timeout_unknown');
        settled = true;
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        response?.destroy();
        req.destroy();
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(Error('docker_engine_aborted_unknown'));
      const req = request({ socketPath: this.socketPath, path: '/v1.45' + path, method,
        headers: bytes ? { 'Content-Type': rawArchive ? 'application/x-tar' : 'application/json', 'Content-Length': bytes.length } : {}, }, incoming => {
        response = incoming;
        if (settled) { incoming.destroy(); return; }
        const chunks: Buffer[] = []; let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maximumResponseBytes) { finish(Error('docker_engine_response_limit')); return; }
          chunks.push(chunk);
        });
        incoming.on('error', error => finish(error));
        incoming.on('aborted', () => finish(Error('docker_engine_response_aborted_unknown')));
        incoming.on('end', () => {
          if (settled) return;
          const data = Buffer.concat(chunks);
          if ((incoming.statusCode ?? 500) >= 400) { finish(new Error('docker_engine_http_' + incoming.statusCode, { cause: { method, path, response: data.toString('utf8').slice(0, 2048) } })); return; }
          try { finish(undefined, returnHeaders ? { ...incoming.headers } : binary ? data : data.length ? JSON.parse(data.toString('utf8')) : undefined); } catch { finish(Error('docker_engine_invalid_json')); }
        });
      });
      // Absolute request lifetime: socket idle timers can be refreshed indefinitely by drip responses.
      const remainingMs = Math.max(0, Number(expiresAt - process.hrtime.bigint()) / 1_000_000);
      const deadline = setTimeout(() => finish(Error('docker_engine_timeout_unknown')), remainingMs);
      req.on('error', error => finish(error));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      if (bytes) req.write(bytes); req.end();
    });
  }
  private id(id: string): string { if (!/^[a-f0-9]{64}$/.test(id)) throw Error('docker_engine_container_id'); return id; }
  /** Private staging phase only. Durable runner must deny this method after sealing input. */
  async populateInputFile(holderId: string, input: {path: string; bytes: Buffer; executable: boolean}, signal?: AbortSignal): Promise<void> {
    const id = this.id(holderId), archive = buildInputFileArchive(input);
    await this.call('PUT', '/containers/' + id + '/archive?path=%2Finputs&noOverwriteDirNonDir=true&copyUIDGID=true', archive, false, 30000, signal);
  }
  async createVolume(proposal: VolumeProposal): Promise<void> {
    const body = buildDockerVolumeRequest(proposal);
    const result = await this.call('POST', '/volumes/create', body);
    this.assertVolume(result, body);
  }
  private assertVolume(result: any, body: ReturnType<typeof buildDockerVolumeRequest>): void {
    if (!result || result.Name !== body.Name || result.Driver !== 'local' || result.Scope !== 'local'
      || JSON.stringify(Object.entries(result.Options ?? {}).sort()) !== JSON.stringify(Object.entries(body.DriverOpts).sort())
      || JSON.stringify(Object.entries(result.Labels ?? {}).sort()) !== JSON.stringify(Object.entries(body.Labels).sort())) throw Error('docker_volume_inspection');
  }
  async inspectVolume(proposal: VolumeProposal): Promise<void> {
    const body = buildDockerVolumeRequest(proposal);
    this.assertVolume(await this.call('GET', '/volumes/' + body.Name), body);
  }
  /** Private exact cleanup only. Upper owner must retain its qualified engine epoch and resource identity. */
  async removeVolume(proposal: VolumeProposal): Promise<void> {
    const frozen = JSON.parse(JSON.stringify(buildDockerVolumeRequest(proposal)));
    this.assertVolume(await this.call('GET', '/volumes/' + frozen.Name), frozen);
    await this.call('DELETE', '/volumes/' + frozen.Name + '?force=false');
  }
  async isVolumeAbsent(proposal: VolumeProposal): Promise<boolean> {
    const body=buildDockerVolumeRequest(proposal);
    try {this.assertVolume(await this.call('GET','/volumes/'+body.Name),body);return false;}
    catch(error){if(error instanceof Error&&error.message==='docker_engine_http_404')return true;throw error;}
  }
  async isContainerAbsent(id:string):Promise<boolean>{
    this.id(id);try{await this.inspect(id);return false;}catch(error){if(error instanceof Error&&error.message==='docker_engine_http_404')return true;throw error;}
  }
  async createMounted(body: ReturnType<typeof buildDockerMountedRequest>): Promise<{ Id: string }> {
    const role = body.Labels['xiaok.role'];
    const common = { imageDigest: body.Image, attemptId: body.Labels['xiaok.attempt'], scopeDigest: body.Labels['xiaok.scope'], inputVolume: body.HostConfig.Mounts[0]?.Source, outputVolume: body.HostConfig.Mounts[1]?.Source };
    const rebuilt = role === 'holder' ? buildDockerMountedRequest({ ...common, role }) : buildDockerMountedRequest({ ...common, role: 'worker', command: { argv: body.Cmd, cwdRelative: body.WorkingDir === '/inputs' ? '.' : body.WorkingDir.slice('/inputs/'.length) }, ...(body.OpenStdin===true?{stdin:{sha256:(body.Labels as Record<string,string>)['xiaok.stdin-sha256'],bytes:Number((body.Labels as Record<string,string>)['xiaok.stdin-bytes'])}}:{}) });
    if (JSON.stringify(body) !== JSON.stringify(rebuilt)) throw Error('docker_engine_unapproved_spec');
    const image = await this.call('GET', '/images/' + rebuilt.Image + '/json');
    if (!image || image.Id !== rebuilt.Image) throw Error('docker_engine_image_identity');
    assertDockerImageConfiguration(image.Config);
    const result = await this.call('POST', '/containers/create?name=' + encodeURIComponent('xiaok-' + rebuilt.Labels['xiaok.attempt']), rebuilt);
    if (!result || typeof result.Id !== 'string') throw Error('docker_engine_create_unknown');
    return Object.freeze({ Id: this.id(result.Id) });
  }
  /** Reconciliation lookup only. Never creates or starts a replacement container. */
  async findMountedAttempt(attemptId: string): Promise<{ Id: string }> {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(attemptId)) throw Error('docker_engine_attempt_identity');
    const name='xiaok-'+attemptId,result=await this.call('GET','/containers/'+encodeURIComponent(name)+'/json');
    if (!result || result.Name!=='/'+name) throw Error('docker_engine_attempt_identity');
    return Object.freeze({Id:this.id(result.Id)});
  }
  private approvedRequest(body: ReturnType<typeof buildDockerWorkerRequest>): ReturnType<typeof buildDockerWorkerRequest> {
    const request={ imageDigest: body.Image, argv: body.Cmd, attemptId: body.Labels['xiaok.attempt'], scopeDigest: body.Labels['xiaok.scope'] },labels=body.Labels as Record<string,string>;
    const rebuilt = body.OpenStdin===true?buildDockerStdinWorkerRequest({request,stdin:{sha256:labels['xiaok.stdin-sha256'],bytes:Number(labels['xiaok.stdin-bytes'])}}):buildDockerWorkerRequest(request);
    if (JSON.stringify(body) !== JSON.stringify(rebuilt)) throw Error('docker_engine_unapproved_spec');
    return rebuilt;
  }
  async create(body: ReturnType<typeof buildDockerWorkerRequest>): Promise<{ Id: string }> {
    // Hold our own complete policy snapshot before the first asynchronous engine operation.
    body = this.approvedRequest(body);
    const image = await this.call('GET', '/images/' + body.Image + '/json');
    if (!image || image.Id !== body.Image) throw Error('docker_engine_image_identity');
    assertDockerImageConfiguration(image.Config);
    // An immutable host-issued attempt name permits lookup after a lost create response.
    // A conflict is unknown, never permission to create a second execution or start it.
    const result = await this.call('POST', '/containers/create?name=' + encodeURIComponent('xiaok-' + body.Labels['xiaok.attempt']), body);
    if (!result || typeof result.Id !== 'string') throw Error('docker_engine_create_unknown');
    this.id(result.Id); return Object.freeze({ Id: result.Id });
  }
  /** Identity lookup only. Missing containers remain unknown; this neither starts nor proves quiescence. */
  async recoverAttempt(body: ReturnType<typeof buildDockerWorkerRequest>): Promise<{ Id: string }> {
    body = this.approvedRequest(body);
    const name = 'xiaok-' + body.Labels['xiaok.attempt'];
    const result = await this.call('GET', '/containers/' + encodeURIComponent(name) + '/json');
    if (!result || result.Name !== '/' + name || result.Image !== body.Image || !result.Config?.Labels
      || Object.entries(body.Labels).some(([key, value]) => result.Config.Labels[key] !== value)) throw Error('docker_engine_attempt_identity');
    return Object.freeze({ Id: this.id(result.Id) });
  }
  async attachOutput(id:string,options:{timeoutMs?:number;maximumBytes?:number;signal?:AbortSignal;stdin?:Buffer}={}):Promise<AttachedOutputCapture>{return attachDockerOutput(this.socketPath,this.id(id),options);}
  async start(id: string): Promise<void> { await this.call('POST', '/containers/' + this.id(id) + '/start'); }
  async wait(id: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ StatusCode: number }> {
    const timeoutMs = options.timeoutMs ?? 300000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000) throw Error('docker_engine_wait_limit');
    const result = await this.call('POST', '/containers/' + this.id(id) + '/wait?condition=not-running', undefined, false, timeoutMs, options.signal);
    if (!result || !Number.isSafeInteger(result.StatusCode)) throw Error('docker_engine_wait_unknown'); return result;
  }
  async inspect(id: string): Promise<{ Id: string; State: { Running: boolean; Pid: number; ExitCode: number; Status: string }; HostConfig: Record<string, unknown>; Config: Record<string, unknown>; Image: string }> {
    const result = await this.call('GET', '/containers/' + this.id(id) + '/json');
    if (!result || result.Id !== id || !result.State || typeof result.State.Running !== 'boolean' || !Number.isSafeInteger(result.State.Pid)) throw Error('docker_engine_inspect_unknown'); return result;
  }
  async kill(id: string): Promise<void> { await this.call('POST', '/containers/' + this.id(id) + '/kill?signal=KILL'); }
  async logs(id: string): Promise<string> {
    const bytes = await this.call('GET', '/containers/' + this.id(id) + '/logs?stdout=1&stderr=1&tail=all', undefined, true) as Buffer;
    const chunks: Buffer[] = []; let offset = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length || ![1, 2].includes(bytes[offset])) throw Error('docker_log_frame');
      const length = bytes.readUInt32BE(offset + 4); offset += 8;
      if (offset + length > bytes.length) throw Error('docker_log_frame'); chunks.push(bytes.subarray(offset, offset + length)); offset += length;
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  /** Untrusted archive bytes only. Installed caller separately holds the worker's
   * exact physical receipt and opaque output-volume/holder binding before/after export. */
  async readArtifactArchive(id: string, relativePath: string, options: { signal?: AbortSignal;maxBytes?:number } = {}): Promise<Buffer> {
    return this.readMountedArchive(id, 'artifacts', relativePath, options.signal,options.maxBytes);
  }
  /** Private input-sealing verification, never a model-selected container read. */
  async readInputArchive(id: string, relativePath: string, options: { signal?: AbortSignal } = {}): Promise<Buffer> {
    return this.readMountedArchive(id, 'inputs', relativePath, options.signal);
  }
  private async readMountedArchive(id: string, root: 'artifacts' | 'inputs', relativePath: string, signal?: AbortSignal,maxBytes=16*1024**2): Promise<Buffer> {
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>16*1024**2)throw Error('docker_artifact_limit');
    const containerId = this.id(id);
    if (typeof relativePath !== 'string' || !relativePath || Buffer.byteLength(relativePath) > 4096 || relativePath.includes('\\') || relativePath.split('/').length > 64 || relativePath.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f:]/.test(part))) throw Error('docker_artifact_path');
    const parts = [root, ...relativePath.split('/')];
    for (let i = 0; i < parts.length; i++) {
      const path = '/' + parts.slice(0, i + 1).join('/');
      const headers = await this.call('HEAD', '/containers/' + containerId + '/archive?path=' + encodeURIComponent(path), undefined, false, 15000, signal, 8192, true);
      const encoded = headers['x-docker-container-path-stat'];
      if (typeof encoded !== 'string' || encoded.length > 8192) throw Error('docker_artifact_stat_unknown');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded) throw Error('docker_artifact_stat_unknown');
      let stat: any; try { stat = JSON.parse(bytes.toString('utf8')); } catch { throw Error('docker_artifact_stat_unknown'); }
      if (!stat || stat.name !== parts[i] || !Number.isSafeInteger(stat.mode) || stat.mode < 0 || stat.mode > 0xffffffff || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.linkTarget !== '') throw Error('docker_artifact_type');
      const type = (stat.mode & 0x8f280000) >>> 0; // Go FileMode.ModeType, not POSIX st_mode.
      if (i < parts.length - 1 ? type !== 0x80000000 : type !== 0 || stat.size > 16 * 1024 ** 2) throw Error('docker_artifact_type');
      if(i===parts.length-1&&stat.size>maxBytes)throw Error('docker_artifact_limit');
    }
    return this.call('GET', '/containers/' + containerId + '/archive?path=' + encodeURIComponent('/' + root + '/' + relativePath), undefined, true, 15000, signal, maxBytes + 8192) as Promise<Buffer>;
  }
  async remove(id: string): Promise<void> {
    const state = await this.inspect(id); if (state.State.Running || state.State.Pid !== 0) throw Error('docker_engine_remove_running');
    await this.call('DELETE', '/containers/' + this.id(id) + '?v=1&force=0');
  }
}
