/** Wall time is display/preflight only. Actual execution permission always uses
 * the installed broker's continuous clock; this conversion grants nothing. */
export function qualificationDisplayDeadline(input:{originalWallSample:number;originalWallDeadline:number;currentWallSample:number;continuousRemainingMs:number}):number{
 const {originalWallSample,originalWallDeadline,currentWallSample,continuousRemainingMs}=input;
 if(![originalWallSample,originalWallDeadline,currentWallSample,continuousRemainingMs].every(Number.isSafeInteger)||originalWallSample<0||originalWallDeadline<=originalWallSample||currentWallSample<originalWallSample||continuousRemainingMs<=0)throw Error('qualification_display_clock_changed');
 const expires=Math.min(originalWallDeadline,currentWallSample+continuousRemainingMs);if(!Number.isSafeInteger(expires)||expires<=currentWallSample)throw Error('qualification_display_expired');return expires;
}
