/* Test-only harness imports the actual private AppKit controller. No production
 * root entry or SecurityAgent bypass is compiled into the shipped helper. */
#import "review-panel.m"
#include <assert.h>
static int alive=1;
static int current(unsigned int uid,unsigned int session,uint64_t deadline){(void)uid;(void)session;(void)deadline;return alive;}
static XiaokReviewPanel *makePanel(NSString *contents){
 XiaokReviewPanel *p=[XiaokReviewPanel new];p.uid=501;p.session=10;p.deadline=100;p.current=current;
 p.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,300,150) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];p.window.releasedWhenClosed=NO;p.window.delegate=p;
 p.scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,0,300,100)];p.text=[[NSTextView alloc] initWithFrame:NSMakeRect(0,0,300,100)];p.text.verticallyResizable=YES;p.text.horizontallyResizable=NO;p.text.textContainer.widthTracksTextView=YES;p.text.string=contents;p.scroll.documentView=p.text;[p.window.contentView addSubview:p.scroll];p.proceed=[NSButton new];return p;
}
static void modal(XiaokReviewPanel *p,void(^action)(void)){
 NSTimer *timer=[NSTimer timerWithTimeInterval:0.02 repeats:NO block:^(NSTimer *t){(void)t;action();}];[[NSRunLoop mainRunLoop] addTimer:timer forMode:NSModalPanelRunLoopMode];[NSApp runModalForWindow:p.window];[timer invalidate];p.window.delegate=nil;[p.window close];
}
int main(void){@autoreleasepool {
 assert([safeLabel(@"owner\u061creceiver") isEqualToString:@"owner\\u061creceiver"]);
 assert([safeLabel(@"x\u00ady\u200ez\u2066w\ufeff") isEqualToString:@"x\\u00ady\\u200ez\\u2066w\\ufeff"]);
 assert([safeLabel(@"x\U0001bca0y") isEqualToString:@"x\\ud82f\\udca0y"]);
 assert([safeLabel(@"原始任务") isEqualToString:@"原始任务"]);

 NSDictionary *binding=@{@"kind":@"loop",@"subject":@{@"loopId":@"personal-assistant-morning-briefing",@"runId":@"actual-run",@"stage":[NSNull null]},@"candidateId":@"batch-id",@"candidateRevision":@2,@"originalTriggerJson":@"{\"kind\":\"manual\"}",@"logicalRunKey":@"original-day",@"contract":@{@"objective":@"原始目标",@"completionCriterion":@"完整验收"},@"body":@{@"kind":@"assistant-morning",@"recommendations":@[@{@"title":@"完整建议正文",@"reasonCode":@"due",@"evidenceRefs":@[@{@"kind":@"task",@"id":@"original-evidence"}]}],@"artifacts":@[]}};
 NSDictionary *review=@{@"binding":binding,@"registrationHash":@"original-registration"};
 NSString *chinese=applicationReviewSummary(review,YES),*english=applicationReviewSummary(review,NO);
 for(NSString *text in @[chinese,english])for(NSString *field in @[@"actual-run",@"batch-id",@"original-day",@"原始目标",@"完整验收",@"完整建议正文",@"original-evidence",@"original-registration"])assert([text containsString:field]);
 assert([chinese containsString:@"不是完成证明"]);assert([english containsString:@"not a completion proof"]);
 assert(!applicationReviewSummary(@{@"binding":@{@"kind":@"unknown"}},YES));
 assert(!applicationReviewSummary(@{@"binding":[NSNull null]},YES));
 NSString *goal=applicationReviewSummary(@{@"binding":@{@"kind":@"goal",@"goalId":@"original-goal",@"sessionId":@"original-session",@"objective":@"original-objective"}},NO);
 assert([goal containsString:@"original-goal"]&&[goal containsString:@"original-session"]&&[goal containsString:@"original-objective"]);
 NSDictionary *intent=@{@"binding":@{@"kind":@"intent",@"subject":@{@"sessionId":@"actual-intent-session",@"intentId":@"original-intent",@"stageId":@"original-stage"},@"candidateId":@"intent-candidate",@"candidateRevision":@2,@"contract":@{@"rawIntent":@"原始完整意图",@"explicitConstraints":@[@"不可删减"]},@"body":@{@"summary":@"真实候选正文",@"artifacts":@[]}},@"registrationHash":@"intent-original-registration"};
 for(NSNumber *locale in @[@YES,@NO]){NSString *text=applicationReviewSummary(intent,locale.boolValue);assert(text);for(NSString *field in @[@"actual-intent-session",@"original-intent",@"original-stage",@"intent-candidate",@"原始完整意图",@"不可删减",@"真实候选正文",@"intent-original-registration"])assert([text containsString:field]);}
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
 __weak XiaokReviewPanel *timerOwned;
 @autoreleasepool {
  XiaokReviewPanel *owned=makePanel(@"full review");owned.timer=[NSTimer timerWithTimeInterval:60 target:owned selector:@selector(refresh:) userInfo:nil repeats:YES];
  [[NSRunLoop mainRunLoop] addTimer:owned.timer forMode:NSDefaultRunLoopMode];timerOwned=owned;owned=nil;
 }
 assert(timerOwned); /* The real scheduled repeating timer retains its target. */
 @autoreleasepool {
  XiaokReviewPanel *cleanup=timerOwned;[cleanup.timer invalidate];cleanup.window.delegate=nil;[cleanup.window close];cleanup=nil;
 }
 assert(!timerOwned); /* Production cleanup breaks the actual timer ownership cycle. */

 alive=1;XiaokReviewPanel *p=makePanel(@"complete");[p refresh:nil];assert(p.proceed.enabled);
 modal(p,^{alive=0;[p approve:nil];});assert(p.closed&&!p.accepted); /* expiry wins even if button was enabled */
 alive=1;p=makePanel(@"complete");modal(p,^{[p windowShouldClose:p.window];});assert(p.closed&&!p.accepted);
 alive=1;p=makePanel(@"complete");[p refresh:nil];assert(p.proceed.enabled);
 p.text.string=[@"long line\n" stringByPaddingToLength:10000 withString:@"long line\n" startingAtIndex:0];[p refresh:nil];assert(!p.proceed.enabled); /* no inherited continue permission */
 modal(p,^{[p approve:nil];assert(!p.closed&&!p.accepted);[p cancel:nil];});assert(!p.accepted);
 alive=1;p=makePanel(@"complete");modal(p,^{[p approve:nil];});assert(p.accepted);
 }return 0;}
