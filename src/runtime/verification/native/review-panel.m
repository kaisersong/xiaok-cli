#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include "review-panel.h"
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <mach/mach_time.h>
#include <errno.h>
#include <CommonCrypto/CommonDigest.h>
static ssize_t application_read(int fd,void *bytes,size_t size){ssize_t n;do{n=read(fd,bytes,size);}while(n<0&&errno==EINTR);return n;}
static int application_exact(int fd,unsigned char *bytes,size_t length){size_t at=0;while(at<length){ssize_t n=application_read(fd,bytes+at,length-at);if(n<=0)return 0;at+=(size_t)n;}return 1;}
static int application_frame_size(int fd,size_t *size){unsigned char b[4];if(!application_exact(fd,b,4))return 0;*size=((size_t)b[0]<<24)|((size_t)b[1]<<16)|((size_t)b[2]<<8)|b[3];return *size>0&&*size<=65532;}
static int application_ascii(const unsigned char *bytes,size_t length){for(size_t i=0;i<length;i++)if(bytes[i]<32||bytes[i]>=127)return 0;return 1;}
unsigned char *xiaok_read_application_review(int fd,size_t *length){
 if(!length)return NULL;*length=0;unsigned char prefix[8];size_t got=0;
 while(got<8){ssize_t n=application_read(fd,prefix+got,8-got);if(n<0)return NULL;if(!n)break;got+=(size_t)n;}
 if(got!=8||memcmp(prefix,"XIAKAP1\n",8)){
  unsigned char *bytes=malloc(65537);if(!bytes)return NULL;memcpy(bytes,prefix,got);size_t at=got;
  for(;;){ssize_t n=application_read(fd,bytes+at,65537-at);if(n<0){free(bytes);return NULL;}if(!n)break;at+=(size_t)n;if(at>65536){free(bytes);return NULL;}}
  if(!at||!application_ascii(bytes,at)){free(bytes);return NULL;}bytes[at]=0;*length=at;return bytes;
 }
 size_t headerLength=0;if(!application_frame_size(fd,&headerLength)||headerLength>4096)return NULL;
 unsigned char header[4097];if(!application_exact(fd,header,headerLength)||!application_ascii(header,headerLength))return NULL;header[headerLength]=0;
 @autoreleasepool {
  id value=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:header length:headerLength] options:0 error:NULL];if(![value isKindOfClass:[NSDictionary class]])return NULL;
  NSDictionary *h=value;NSArray *keys=@[@"version",@"purpose",@"encoding",@"totalBytes",@"reviewHash",@"chunkCount"];
  if(h.count!=keys.count||![[NSSet setWithArray:h.allKeys] isEqualToSet:[NSSet setWithArray:keys]])return NULL;
  if(![h[@"totalBytes"] isKindOfClass:[NSNumber class]]||![h[@"chunkCount"] isKindOfClass:[NSNumber class]]||![h[@"reviewHash"] isKindOfClass:[NSString class]])return NULL;
  NSUInteger total=[h[@"totalBytes"] unsignedIntegerValue],chunks=[h[@"chunkCount"] unsignedIntegerValue];NSString *hash=h[@"reviewHash"];
  if(!total||total>1048576||chunks!=(total+65531)/65532||hash.length!=64||[hash rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location!=NSNotFound)return NULL;
  NSString *canonical=[NSString stringWithFormat:@"{\"chunkCount\":%lu,\"encoding\":\"canonical-ascii-chunks\",\"purpose\":\"completion-application-binding\",\"reviewHash\":\"%@\",\"totalBytes\":%lu,\"version\":1}",(unsigned long)chunks,hash,(unsigned long)total];NSData *canonicalBytes=[canonical dataUsingEncoding:NSASCIIStringEncoding];
  if(canonicalBytes.length!=headerLength||memcmp(canonicalBytes.bytes,header,headerLength))return NULL;
  unsigned char *bytes=malloc(total+1);if(!bytes)return NULL;size_t at=0;
  for(NSUInteger i=0;i<chunks;i++){size_t size=0,expected=total-at>65532?65532:total-at;if(!application_frame_size(fd,&size)||size!=expected||!application_exact(fd,bytes+at,size)){free(bytes);return NULL;}at+=size;}
  unsigned char trailing;if(application_read(fd,&trailing,1)!=0||!application_ascii(bytes,total)){free(bytes);return NULL;}
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CC_SHA256(bytes,(CC_LONG)total,digest);
#pragma clang diagnostic pop
  char hex[65];for(size_t i=0;i<sizeof(digest);i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
  if(strcmp(hex,hash.UTF8String)){free(bytes);return NULL;}
  id review=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes length:total] options:0 error:NULL];
  if(![review isKindOfClass:[NSDictionary class]]||![review[@"purpose"] isEqual:@"completion-application-binding"]||![review[@"binding"] isKindOfClass:[NSDictionary class]]||![review[@"binding"][@"kind"] isEqual:@"intent"]){free(bytes);return NULL;}
  bytes[total]=0;*length=total;return bytes;
 }
}


char *xiaok_review_text_for_purpose(const unsigned char *bytes,size_t length,const char *purpose) {
 size_t limit=purpose&&(strcmp(purpose,"completion-publication")==0||strcmp(purpose,"profile-source-custody")==0)?7*1024*1024:65536;
 if(purpose&&strcmp(purpose,"completion-application-binding")==0&&bytes&&length>65536&&length<=1048576){
  id r=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes length:length] options:0 error:NULL];
  if([r isKindOfClass:[NSDictionary class]]&&[r[@"purpose"] isEqual:@"completion-application-binding"]&&[r[@"binding"] isKindOfClass:[NSDictionary class]]&&[r[@"binding"][@"kind"] isEqual:@"intent"])limit=1048576;
 }
 if(!bytes||!length||length>limit||memchr(bytes,0,length))return NULL;
 for(size_t i=0;i<length;i++)if(bytes[i]<32||bytes[i]>=127)return NULL;
 char *result=malloc(length+1);if(!result)return NULL;memcpy(result,bytes,length);result[length]=0;return result;
}
char *xiaok_review_text(const unsigned char *bytes,size_t length){return xiaok_review_text_for_purpose(bytes,length,NULL);}
/* Display raw JSON alongside a readable summary. Dangerous Unicode formatting
 * stays escaped even in the summary; the signed bytes are never reconstructed. */
static NSString *safeLabel(id value) {
 NSString *text=[value isKindOfClass:[NSString class]]?value:[value description];
 if(!text)return @"";NSMutableString *result=[NSMutableString string];
 NSCharacterSet *controls=[NSCharacterSet controlCharacterSet];
 for(NSUInteger i=0;i<text.length;i++){unichar c=[text characterAtIndex:i];UTF32Char scalar=c;NSUInteger width=1;
  if(c>=0xd800&&c<=0xdbff&&i+1<text.length){unichar low=[text characterAtIndex:i+1];if(low>=0xdc00&&low<=0xdfff){scalar=0x10000+(((UTF32Char)c-0xd800)<<10)+(low-0xdc00);width=2;}}
  // Foundation's Unicode control set includes Cc/Cf. Check full scalars so
  // supplementary formatting controls cannot bypass a UTF-16 code-unit filter.
  if([controls longCharacterIsMember:scalar]||scalar==0x2028||scalar==0x2029){for(NSUInteger j=0;j<width;j++)[result appendFormat:@"\\u%04x",[text characterAtIndex:i+j]];}
  else [result appendString:[text substringWithRange:NSMakeRange(i,width)]];
  i+=width-1;
 }return result;
}
/* Summary is display-only; the unchanged, complete signed JSON follows it. */
static NSString *applicationReviewSummary(NSDictionary *object,BOOL zh) {
 NSDictionary *b=[object[@"binding"] isKindOfClass:[NSDictionary class]]?object[@"binding"]:nil;
 if(!b)return nil;
 NSMutableString *summary=[NSMutableString string];
 if([b[@"kind"] isEqualToString:@"goal"]){[summary appendFormat:zh?@"Goal: %@\n会话: %@\n业务代次: %@\n目标: %@\n完成条件: %@\n证据种类: %@\n原登记 SHA-256: %@\n验收规则沿用先前批准的登记；本次不修改规则。\n":@"Goal: %@\nSession: %@\nEpoch: %@\nObjective: %@\nCompletion criterion: %@\nEvidence kinds: %@\nOriginal registration SHA-256: %@\nCompletion rules remain those approved previously; this action does not change them.\n",safeLabel(b[@"goalId"]),safeLabel(b[@"sessionId"]),safeLabel(b[@"epoch"]),safeLabel(b[@"objective"]),safeLabel(b[@"completionCriterion"]),safeLabel(b[@"expectedEvidenceKinds"]),safeLabel(object[@"registrationHash"])];}
 else if([b[@"kind"] isEqualToString:@"loop"]){
  NSDictionary *subject=[b[@"subject"] isKindOfClass:[NSDictionary class]]?b[@"subject"]:nil;
  NSDictionary *stage=[subject[@"stage"] isKindOfClass:[NSDictionary class]]?subject[@"stage"]:nil;
  if(!subject||![b[@"contract"] isKindOfClass:[NSDictionary class]]||![b[@"body"] isKindOfClass:[NSDictionary class]])return nil;
  NSData *contract=[NSJSONSerialization dataWithJSONObject:b[@"contract"] options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:nil];
  NSData *body=[NSJSONSerialization dataWithJSONObject:b[@"body"] options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:nil];
  if(!contract||!body)return nil;
  [summary appendFormat:zh?@"Loop: %@\n运行: %@\n阶段: %@ / %@\n候选批次: %@\n候选版本: %@\n原触发: %@\n原逻辑运行标识: %@\n完整业务合同:\n%@\n完整候选内容与产物声明:\n%@\n原登记 SHA-256: %@\n本次绑定不是完成证明；执行验证和结果发布仍须完成各自授权。原验收规则不变。\n":@"Loop: %@\nRun: %@\nStage: %@ / %@\nCandidate batch: %@\nCandidate revision: %@\nOriginal trigger: %@\nOriginal logical run key: %@\nComplete business contract:\n%@\nComplete candidate content and artifact declarations:\n%@\nOriginal registration SHA-256: %@\nThis binding is not a completion proof. Verification and publication still require their own authorization. Original completion rules remain unchanged.\n",
   safeLabel(subject[@"loopId"]),safeLabel(subject[@"runId"]),safeLabel(stage[@"stageId"]),safeLabel(stage[@"stageKind"]),safeLabel(b[@"candidateId"]),safeLabel(b[@"candidateRevision"]),safeLabel(b[@"originalTriggerJson"]),safeLabel(b[@"logicalRunKey"]),safeLabel([[NSString alloc] initWithData:contract encoding:NSUTF8StringEncoding]),safeLabel([[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding]),safeLabel(object[@"registrationHash"])];
 }else if([b[@"kind"] isEqualToString:@"intent"]){
  NSDictionary *subject=[b[@"subject"] isKindOfClass:[NSDictionary class]]?b[@"subject"]:nil;
  if(!subject||![b[@"contract"] isKindOfClass:[NSDictionary class]]||![b[@"body"] isKindOfClass:[NSDictionary class]])return nil;
  NSData *contract=[NSJSONSerialization dataWithJSONObject:b[@"contract"] options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:nil];
  NSData *body=[NSJSONSerialization dataWithJSONObject:b[@"body"] options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:nil];
  if(!contract||!body)return nil;
  [summary appendFormat:zh?@"Intent: %@\n会话: %@\n阶段（空值为父意图）: %@\n候选: %@\n候选版本: %@\n完整原业务合同与义务:\n%@\n完整候选正文、执行报告与产物声明:\n%@\n原登记 SHA-256: %@\n本次绑定不是完成证明；报告不替代独立验证，父意图不代替阶段发布。\n":@"Intent: %@\nSession: %@\nStage (null means parent intent): %@\nCandidate: %@\nCandidate revision: %@\nComplete original business contract and obligations:\n%@\nComplete candidate content, execution reports and artifact declarations:\n%@\nOriginal registration SHA-256: %@\nThis binding is not a completion proof. Reports do not replace independent verification, and parent intent approval does not publish stages.\n",
   safeLabel(subject[@"intentId"]),safeLabel(subject[@"sessionId"]),safeLabel(subject[@"stageId"]),safeLabel(b[@"candidateId"]),safeLabel(b[@"candidateRevision"]),safeLabel([[NSString alloc] initWithData:contract encoding:NSUTF8StringEncoding]),safeLabel([[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding]),safeLabel(object[@"registrationHash"])];
 }else return nil;
 return summary;
}
@interface XiaokReviewPanel : NSObject <NSWindowDelegate>
@property (strong) NSWindow *window;
@property (strong) NSScrollView *scroll;
@property (strong) NSTextView *text;
@property (strong) NSButton *proceed;
@property (strong) NSTimer *timer;
@property (strong) NSTextField *expires;
@property (strong) NSString *expiresPrefix;
@property BOOL accepted;
@property BOOL closed;
@property unsigned int uid;
@property unsigned int session;
@property uint64_t deadline;
@property int (*current)(unsigned int,unsigned int,uint64_t);
@end
@implementation XiaokReviewPanel
-(BOOL)live { return self.current&&self.current(self.uid,self.session,self.deadline); }
-(BOOL)atBottom {
 NSLayoutManager *layout=self.text.layoutManager;[layout ensureLayoutForTextContainer:self.text.textContainer];
 NSRect used=[layout usedRectForTextContainer:self.text.textContainer],visible=self.scroll.contentView.bounds;return NSMaxY(visible)>=NSMaxY(used)+self.text.textContainerInset.height-2;
}
-(void)refresh:(id)sender {
 (void)sender;if(self.closed)return;
 if(![self live]){[self cancel:nil];return;}
 // Recalculate from this immutable view on every resize/scroll/timer tick. No
 // cached "read" bit survives a changed viewport or a new panel instance.
 self.proceed.enabled=[self atBottom];
 mach_timebase_info_data_t info;if(self.expires&&mach_timebase_info(&info)==KERN_SUCCESS&&info.denom){__uint128_t ms=(__uint128_t)mach_continuous_time()*info.numer/info.denom/1000000;uint64_t remaining=ms<self.deadline?self.deadline-(uint64_t)ms:0;self.expires.stringValue=[NSString stringWithFormat:@"%@ %llu s",self.expiresPrefix,(unsigned long long)(remaining/1000)];}
}
-(void)cancel:(id)sender {(void)sender;if(self.closed)return;self.closed=YES;self.accepted=NO;[NSApp stopModalWithCode:NSModalResponseCancel];[self.window orderOut:nil];}
-(void)approve:(id)sender {(void)sender;if(self.closed)return;if(![self live]||![self atBottom]){[self refresh:nil];return;}self.accepted=YES;self.closed=YES;[NSApp stopModalWithCode:NSModalResponseOK];[self.window orderOut:nil];}
-(BOOL)windowShouldClose:(NSWindow *)sender {(void)sender;[self cancel:nil];return NO;}
-(void)windowDidResize:(NSNotification *)note {(void)note;[self refresh:nil];}
@end
int xiaok_review_panel(const unsigned char *bytes,size_t length,unsigned int uid,unsigned int session,uint64_t deadline,const char *purpose,int (*current)(unsigned int,unsigned int,uint64_t)) {
 if(getuid()!=0||geteuid()!=0||!current||!current(uid,session,deadline))return 0;
 char *copy=xiaok_review_text_for_purpose(bytes,length,purpose);if(!copy)return 0;
 @autoreleasepool {
  NSString *raw=[[NSString alloc] initWithBytes:copy length:length encoding:NSASCIIStringEncoding];free(copy);if(!raw)return 0;
  NSData *data=[raw dataUsingEncoding:NSASCIIStringEncoding];id object=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];if(![object isKindOfClass:[NSDictionary class]])return 0;
  BOOL zh=[NSLocale.preferredLanguages.firstObject hasPrefix:@"zh"];
  BOOL sourceCustody=purpose&&strcmp(purpose,"profile-source-custody")==0;
  BOOL application=purpose&&strcmp(purpose,"completion-application-binding")==0;
  BOOL archive=purpose&&strcmp(purpose,"execution-archive-access")==0;
  BOOL enrollment=purpose&&strcmp(purpose,"completion-owner-enrollment")==0;
  BOOL publication=purpose&&strcmp(purpose,"completion-publication")==0;
  if((enrollment||publication||archive||application||sourceCustody)&&![object[@"purpose"] isEqualToString:[NSString stringWithUTF8String:purpose]])return 0;
  NSString *purposeText=sourceCustody?(zh?@"批准原存储迁移与写入锁托管":@"Approve original storage migration and writer lock custody"):application?(zh?@"绑定业务内容与原验收规则":@"Bind business content to its approved completion rules"):archive?(zh?@"授权读取或删除执行归档":@"Authorize reading or deleting execution archives"):publication?(zh?@"批准已验证结果的发布":@"Approve publication of verified results"):enrollment?(zh?@"登记完成验收义务":@"Enroll completion obligations"):(zh?@"授权隔离验证读取指定材料":@"Authorize selected materials for isolated execution");
  NSMutableString *summary=[NSMutableString stringWithFormat:@"%@\nUID: %u   Audit session: %u\n\n",purposeText,uid,session];
  if(application){NSString *applicationText=applicationReviewSummary(object,zh);if(!applicationText)return 0;[summary appendString:applicationText];}
  else if(sourceCustody){NSDictionary *set=[object[@"sourceSet"] isKindOfClass:[NSDictionary class]]?object[@"sourceSet"]:nil;NSArray *sources=[set[@"sources"] isKindOfClass:[NSArray class]]?set[@"sources"]:nil;if(!sources)return 0;[summary appendFormat:zh?@"配置标识: %@\n原源集合代次: %@\n完整源数量: %lu\n完整集合 SHA-256: %@\n批准后将阻止原存储的新普通写入，并核对以下全部快照。既有后台执行仍须完成独立静止检查。\n":@"Profile: %@\nOriginal inventory generation: %@\nComplete source count: %lu\nComplete inventory SHA-256: %@\nApproval blocks new ordinary writes to the original stores and checks every snapshot below. Existing background executions still require their independent drain checks.\n",safeLabel(set[@"profileId"]),safeLabel(set[@"inventoryGeneration"]),(unsigned long)sources.count,safeLabel(object[@"inventoryHash"])];for(id value in sources){if(![value isKindOfClass:[NSDictionary class]])return 0;NSDictionary *source=value,*directory=[source[@"directory"] isKindOfClass:[NSDictionary class]]?source[@"directory"]:nil,*database=[source[@"database"] isKindOfClass:[NSDictionary class]]?source[@"database"]:nil;[summary appendFormat:@"\n%@ / %@\n%@%@%@\nSnapshot SHA-256: %@\n",safeLabel(source[@"sourceId"]),safeLabel(source[@"kind"]),safeLabel(directory[@"canonicalPath"]),database?@" / ":@"",database?safeLabel(database[@"basename"]):@"",safeLabel(source[@"reviewedSnapshotSha256"])];}}
  else if(enrollment){NSDictionary *e=object[@"enrollment"];[summary appendFormat:@"Owner: %@ / %@\n",safeLabel(e[@"ownerKind"]),safeLabel(e[@"ownerId"])];NSDictionary *kswarm=e[@"kswarmSubject"];if([kswarm isKindOfClass:[NSDictionary class]]){[summary appendFormat:zh?@"KSwarm 项目: %@\n任务: %@\n本次仅登记原验收规则；不授权任务完成、项目批准或产物发布。\n":@"KSwarm project: %@\nTask: %@\nEnroll original completion rules only; this does not authorize task completion, project approval or artifact publication.\n",safeLabel(kswarm[@"projectId"]),safeLabel(kswarm[@"taskId"])];}NSDictionary *loop=e[@"loopSubject"];if([loop isKindOfClass:[NSDictionary class]]){NSDictionary *stage=[loop[@"stage"] isKindOfClass:[NSDictionary class]]?loop[@"stage"]:nil;[summary appendFormat:zh?@"Loop: %@\n运行: %@\n阶段: %@ / %@\n本次只登记原验收规则；业务合同绑定、执行与结果发布须另行授权。\n":@"Loop: %@\nRun: %@\nStage: %@ / %@\nThis only enrolls original completion rules. Business contract binding, execution and publication require separate authorization.\n",safeLabel(loop[@"loopId"]),safeLabel(loop[@"runId"]),safeLabel(stage[@"stageId"]),safeLabel(stage[@"stageKind"])];}NSDictionary *intent=e[@"intentContract"];if([intent isKindOfClass:[NSDictionary class]]){NSDictionary *subject=intent[@"subject"];[summary appendFormat:zh?@"会话: %@\nIntent: %@\n阶段: %@\n登记完整原合同、独立验收规则及阶段依赖；不批准执行材料或业务完成。\n":@"Session: %@\nIntent: %@\nStage: %@\nEnroll the complete original contract, independent completion rules and stage dependencies; this does not approve execution materials or business completion.\n",safeLabel(subject[@"sessionId"]),safeLabel(subject[@"intentId"]),safeLabel(subject[@"stageId"])];}NSDictionary *fork=object[@"registration"][@"source"][@"fork"];if([fork isKindOfClass:[NSDictionary class]]){[summary appendFormat:zh?@"分叉来源 Goal: %@\n原会话: %@\n新会话: %@\n继承原验收规则及既有依赖，不继承完成证明。\n":@"Fork source Goal: %@\nSource session: %@\nNew session: %@\nOriginal completion rules and dependencies are inherited, not proofs.\n",safeLabel(fork[@"owner"][@"ownerId"]),safeLabel(fork[@"sessionId"]),safeLabel(e[@"goalSessionId"])];}}
  else if(archive){NSDictionary *owner=object[@"owner"],*resource=object[@"resource"];[summary appendFormat:zh?@"所属对象: %@ / %@\n操作: %@\n归档类型: %@\n归档标识: %@\n完整 run 成员数（如适用）: %@\n批准范围为该归档整体；删除不可恢复，不会移除验收义务。\n":@"Owner: %@ / %@\nAction: %@\nArchive kind: %@\nArchive identity: %@\nWhole run member count (if applicable): %@\nThe scope is this entire archive. Deletion is irreversible and does not remove obligations.\n",safeLabel(owner[@"ownerKind"]),safeLabel(owner[@"ownerId"]),safeLabel(object[@"action"]),safeLabel(resource[@"kind"]),safeLabel(resource[@"resourceId"]?:resource[@"sourceRunId"]),safeLabel(resource[@"memberCount"])];if([resource[@"kind"] isEqualToString:@"protected-run"]&&resource[@"archiveHash"]==[NSNull null]){[summary appendString:zh?@"此 run 尚无完整归档；删除包含未归档或缺失捕获记录，不表示运行成功或输出完整。\n":@"This run has no complete archive. Deletion includes unarchived or missing captures and does not establish success or complete output.\n"];} }
  else if(publication){NSDictionary *t=object[@"tuple"];[summary appendFormat:zh?@"所属对象: %@ / %@\n接收方: %@\n操作: %@\n请求来源: %@\n发布内容 SHA-256: %@\n":@"Owner: %@ / %@\nReceiver: %@\nOperation: %@\nRequest source: %@\nPayload SHA-256: %@\n",safeLabel(t[@"ownerKind"]),safeLabel(t[@"ownerId"]),safeLabel(t[@"receiverId"]),safeLabel(t[@"operationId"]),safeLabel(object[@"requestSource"]),safeLabel(t[@"immutablePayloadHash"])];}
  else {for(id item in object[@"materials"]){if([item isKindOfClass:[NSDictionary class]])[summary appendFormat:@"File: %@\n",safeLabel(item[@"path"])];}NSDictionary *command=object[@"exactCommand"];[summary appendFormat:@"Command argv: %@\nDirectory: %@\n",safeLabel(command[@"argv"]),safeLabel(command[@"cwdRelative"])];}
  [summary appendString:zh?@"\n请审阅完整范围。继续后仍须进行独立身份验证；取消不会授予权限。下方完整 JSON 中的转义序列保留原始精确值。\n\n":@"\nReview the entire scope. Continuing requires separate identity authentication; cancellation grants no permission. Escapes in the complete JSON below preserve exact original values.\n\n"];
  [summary appendString:raw];
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  XiaokReviewPanel *panel=[XiaokReviewPanel new];panel.uid=uid;panel.session=session;panel.deadline=deadline;panel.current=current;
  panel.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,900,650) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];panel.window.title=purposeText;panel.window.delegate=panel;panel.window.minSize=NSMakeSize(600,400);panel.window.releasedWhenClosed=NO;
  NSView *content=panel.window.contentView;
  panel.expiresPrefix=zh?@"批准窗口剩余时间：":@"Authorization window remaining:";panel.expires=[NSTextField labelWithString:@""];panel.expires.frame=NSMakeRect(16,50,868,16);panel.expires.autoresizingMask=NSViewWidthSizable;[content addSubview:panel.expires];
  panel.scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(16,68,868,566)];panel.scroll.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;panel.scroll.hasVerticalScroller=YES;panel.scroll.hasHorizontalScroller=YES;
  panel.text=[[NSTextView alloc] initWithFrame:NSMakeRect(0,0,868,566)];panel.text.editable=NO;panel.text.selectable=YES;panel.text.richText=NO;panel.text.importsGraphics=NO;panel.text.automaticLinkDetectionEnabled=NO;panel.text.automaticDataDetectionEnabled=NO;panel.text.verticallyResizable=YES;panel.text.horizontallyResizable=NO;panel.text.autoresizingMask=NSViewWidthSizable;panel.text.textContainer.widthTracksTextView=YES;panel.text.font=[NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];panel.text.string=summary;panel.scroll.documentView=panel.text;[content addSubview:panel.scroll];
  NSButton *cancel=[NSButton buttonWithTitle:zh?@"取消":@"Cancel" target:panel action:@selector(cancel:)];cancel.frame=NSMakeRect(16,18,100,32);cancel.keyEquivalent=@"\e";[content addSubview:cancel];
  panel.proceed=[NSButton buttonWithTitle:zh?@"审阅并继续身份验证":@"Continue to identity authentication" target:panel action:@selector(approve:)];panel.proceed.frame=NSMakeRect(550,18,334,32);panel.proceed.autoresizingMask=NSViewMinXMargin;panel.proceed.enabled=NO;[content addSubview:panel.proceed];
  [panel.window center];[panel.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  panel.timer=[NSTimer timerWithTimeInterval:0.1 target:panel selector:@selector(refresh:) userInfo:nil repeats:YES];[[NSRunLoop mainRunLoop] addTimer:panel.timer forMode:NSRunLoopCommonModes];[[NSRunLoop mainRunLoop] addTimer:panel.timer forMode:NSModalPanelRunLoopMode];
  [panel refresh:nil];if(!panel.closed)[NSApp runModalForWindow:panel.window];[panel.timer invalidate];BOOL approved=panel.accepted&&current(uid,session,deadline);panel.window.delegate=nil;[panel.window close];return approved?1:0;
 }
}
