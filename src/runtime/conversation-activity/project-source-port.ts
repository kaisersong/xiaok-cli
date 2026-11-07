import type {ScopedProjectActivityAudience} from './project-scoped-activity-data.js';
import type {ParsedProjectActivityPage} from './project-delivery-data.js';
/** Fixed host-local port into the existing HTTP owner. Data shape alone never
 * grants authority: both original frames are checked by that owner. */
export interface ProjectSourceHttpFrame {
 readonly page:ParsedProjectActivityPage;
 readonly scoped?:Readonly<{protocol:string;projectId:string;scope:{profileId:string;workspaceId:string};bindingDigest:string;page:ParsedProjectActivityPage}>;
}
export interface ProjectSourcePort {
 assertOwner(owner:object):void;
 read(audience:ScopedProjectActivityAudience,signal:AbortSignal,beforeEffects:()=>void):Promise<ProjectSourceHttpFrame>;
 assertRead(audience:ScopedProjectActivityAudience,frame:ProjectSourceHttpFrame):void;
 assertScoped(audience:ScopedProjectActivityAudience,frame:NonNullable<ProjectSourceHttpFrame['scoped']>):void;
 ensureRound(projectId:string):Promise<void>;
 admitHint?(projectId:string):Readonly<{demandId:string;settled:Promise<void>}>;
}
export type ProjectSourcePage=Readonly<{kind:'project_source_page_v1';page:ParsedProjectActivityPage}>;
