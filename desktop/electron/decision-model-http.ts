import {withDecisionCleanup} from './decision-model-cleanup.js';
import { decisionStockMap } from './decision-model-stock.js';
import { types } from 'node:util';
import { ReadableStream, ReadableStreamDefaultReader } from 'node:stream/web';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, own = Object.hasOwn;
const nativeFetch = fetch, NativePromise = Promise, then = Promise.prototype.then;
const NativeDecoder = TextDecoder, decode = TextDecoder.prototype.decode;
const responseBody = descriptor(Response.prototype, 'body')!.get!, responseStatus = descriptor(Response.prototype, 'status')!.get!;
const responseHeaders = descriptor(Response.prototype, 'headers')!.get!, headerGet = Headers.prototype.get;
const getReader = ReadableStream.prototype.getReader, bodyCancel = ReadableStream.prototype.cancel;
const readerRead = ReadableStreamDefaultReader.prototype.read, readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const release = ReadableStreamDefaultReader.prototype.releaseLock;
const arrayLength = descriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')!.get!;
const members = new WeakSet<object>();
export function assertDecisionModelHttp(value: unknown): asserts value is DecisionModelHttp {
    if (!value || typeof value !== 'object' || !members.has(value))
        throw Error('decision_http_owner');
}
type Row = {
    value: object;
    kind: 'response' | 'reader';
    entered: boolean;
};
export class DecisionModelHttp {
    private readonly custody = createRoomTurnCustody();
    private readonly resources = decisionStockMap<object, Row>();
    private unknown?: {
        raw: unknown;
    };
    private readonly closeResponse = function (this: Response) {
        const body = apply(responseBody, this, []);
        return body ? apply(bodyCancel, body, []) : NativePromise.resolve();
    };
    private readonly closeReader: Function;
    constructor() {
        members.add(this);
        const custody = this.custody;
        this.closeReader = function (this: ReadableStreamDefaultReader) {
            const raw = apply(readerCancel, this, []);
            custody.inventory(raw);
            return apply(then, raw, [() => apply(release, this, [])]);
        };
    }
    private responseContract = {
        accept: (raw: unknown): boolean => {
            if (!raw || typeof raw !== 'object' || types.isProxy(raw))
                return false;
            try {
                apply(responseStatus, raw, []);
            }
            catch {
                return false;
            }
            this.resources.set(raw, { value: raw, kind: 'response', entered: false });
            return true;
        }, consumer: this.closeResponse,
    };
    private get readerContract() {
        return {
            accept: (raw: unknown): boolean => {
                if (!raw || typeof raw !== 'object' || types.isProxy(raw))
                    return false;
                this.resources.set(raw, { value: raw, kind: 'reader', entered: false });
                return true;
            }, consumer: this.closeReader,
        };
    }
    private async closeRow(row: Row): Promise<void> {
        if (row.entered)
            return;
        row.entered = true;
        try {
            const ack = await this.custody.consumeResource(row.kind === 'reader' ? this.closeReader : this.closeResponse, row.value, []);
            if (ack !== undefined)
                throw Error('decision_http_close_contract');
            this.resources.delete(row.value);
        }
        catch (raw) {
            this.unknown ??= { raw };
            throw raw;
        }
    }
    private async cleanup(): Promise<void> {
        const errors: unknown[] = [];
        // Reader cancellation/release must precede Response cancellation, whose body
        // otherwise remains locked. Every entered original is attempted.
        for (const kind of ['reader', 'response'])
            for (const row of [...this.resources.values()])
                if (row.kind === kind) {
                    try {
                        await this.closeRow(row);
                    }
                    catch (raw) {
                        errors.push(raw);
                    }
                }
        if (errors.length)
            throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'decision_http_cleanup', { cause: errors[0] });
    }
    private data(raw: object, key: PropertyKey): unknown {
        const row = descriptor(raw, key);
        if (!row || !own(row, 'value'))
            throw Error('decision_http_read_contract');
        return row.value;
    }
    async request(url: string, init: RequestInit, maxBytes: number, sink?: (bytes: Uint8Array) => void | Promise<void>): Promise<{
        status: number;
        location: string | null;
        text: string;
    }> {
        let first: {
            raw: unknown;
        } | undefined;
        return await withDecisionCleanup(async () => {
            try {
                return await this.custody.root(async () => {
                    const response = await this.custody.sdk<Response>(nativeFetch, undefined, [url, init], this.responseContract);
                    const status = apply(responseStatus, response, []) as number;
                    const headers = apply(responseHeaders, response, []), location = apply(headerGet, headers, ['location']) as string | null;
                    if (!Number.isInteger(status) || status < 100 || status > 599 || location !== null && typeof location !== 'string')
                        throw Error('decision_http_contract');
                    const body = apply(responseBody, response, []);
                    let text = '', bytesRead = 0;
                    const decoder = new NativeDecoder('utf-8', { fatal: true });
                    // Redirect/error bodies are cancelled without constructing a new reader.
                    if (body && status >= 200 && status < 300) {
                        const reader = await this.custody.sdk<ReadableStreamDefaultReader>(getReader, body, [], this.readerContract);
                        const parse = (raw: unknown): {
                            done: boolean;
                            bytes: number[];
                        } => {
                            if (!raw || typeof raw !== 'object' || types.isProxy(raw))
                                throw Error('decision_http_read_contract');
                            const done = this.data(raw, 'done'), value = descriptor(raw, 'value');
                            if (typeof done !== 'boolean')
                                throw Error('decision_http_read_contract');
                            const bytes: number[] = [];
                            if (!done) {
                                if (!value || !own(value, 'value') || types.isProxy(value.value) || !types.isUint8Array(value.value))
                                    throw Error('decision_http_read_contract');
                                const array = value.value as Uint8Array, n = apply(arrayLength, array, []) as number;
                                if (n > 1048576 || bytesRead + n > maxBytes)
                                    throw Error('size_mismatch');
                                for (let i = 0; i < n; i++)
                                    bytes.push(array[i]!);
                            }
                            return { done, bytes };
                        };
                        const consume = async function (this: object) { return parse(this); };
                        for (;;) {
                            const frame = await this.custody.sdk<object>(readerRead, reader, [], { accept: v => !!v && typeof v === 'object' && !types.isProxy(v), consumer: consume });
                            const chunk = await this.custody.consumeResource<{
                                done: boolean;
                                bytes: number[];
                            }>(consume, frame, []);
                            if (chunk.done) {
                                if (!sink)
                                    text += apply(decode, decoder, []);
                                break;
                            }
                            const bytes = Uint8Array.from(chunk.bytes);
                            bytesRead += bytes.length;
                            if (sink)
                                await sink(bytes);
                            else
                                text += apply(decode, decoder, [bytes, { stream: true }]);
                        }
                    }
                    return { status, location, text };
                });
            }
            catch (raw) {
                first = { raw };
                throw raw;
            }
        }, async () => {
            try {
                await this.cleanup();
            }
            catch (raw) {
                if (first)
                    throw new AggregateError([first.raw, raw], 'decision_http_primary_cleanup', { cause: first.raw });
                throw raw;
            }
        });
    }
    async settle(): Promise<void> {
        await this.custody.waitPhysicalKnown();
        if (this.resources.size || this.unknown)
            throw Error('decision_http_unconfirmed', { cause: this.unknown?.raw });
    }
}
