import {join} from 'node:path';
import type {ActivityOwnerConfig} from '../../src/runtime/conversation-activity/owner-runtime.js';

/** The owner config Main writes when it attaches the activity owner. Kept as
 * one function so tests qualify exactly what Main produces. `profileId` is the
 * Desktop service-scope id from resolveDesktopServiceScope. */
export function mainActivityOwnerConfig(dataRoot:string,profileId:string,sourceConfig:Pick<ActivityOwnerConfig,'kswarm'|'managedSources'>):ActivityOwnerConfig{
  return {schemaVersion:1,dataRoot,profileId,actorId:`desktop-user:${profileId}`,identity:{kind:'desktop',path:join(dataRoot,'multi-agent','groups.sqlite')},...sourceConfig};
}
