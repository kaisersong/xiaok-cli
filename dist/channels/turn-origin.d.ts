export interface TurnOrigin {
    source: 'chat' | 'yzj';
    initiator?: string;
    channelTurnId?: string;
}
export declare function runWithTurnOrigin<T>(origin: TurnOrigin, fn: () => T): T;
export declare function getTurnOrigin(): TurnOrigin | undefined;
