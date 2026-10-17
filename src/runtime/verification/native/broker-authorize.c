/* Non-setuid, fixed root-broker child. Parent must enter the original user's
 * bootstrap session with launchctl asuser before invoking this executable. */
#define _DARWIN_C_SOURCE
#include <Security/Authorization.h>
#include <Security/AuthorizationTags.h>
#include <Security/AuthorizationDB.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <unistd.h>
#include <pwd.h>
#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <bsm/audit.h>
#include <mach/mach_time.h>
#include <stdint.h>
#include "review-panel.h"
static int before_deadline(uint64_t deadline) { mach_timebase_info_data_t info; if(mach_timebase_info(&info)!=KERN_SUCCESS||!info.denom)return 0; __uint128_t ms=(__uint128_t)mach_continuous_time()*info.numer/info.denom/1000000; return ms<deadline; }

static int console_is(uid_t uid) { struct stat st; return !stat("/dev/console", &st) && st.st_uid == uid; }
static int active_session(uid_t uid, au_asid_t session) {
  auditinfo_addr_t info;
  const au_asflgs_t required=AU_SESSION_FLAG_HAS_GRAPHIC_ACCESS|AU_SESSION_FLAG_HAS_CONSOLE_ACCESS|AU_SESSION_FLAG_HAS_AUTHENTICATED;
  return !getaudit_addr(&info,sizeof(info)) && info.ai_asid==session && info.ai_auid==uid &&
    (info.ai_flags&required)==required && !(info.ai_flags&(AU_SESSION_FLAG_IS_INITIAL|AU_SESSION_FLAG_IS_REMOTE)) && console_is(uid);
}
static int approval_current(unsigned int uid,unsigned int session,uint64_t deadline) { return getuid()==0&&geteuid()==0&&active_session((uid_t)uid,(au_asid_t)session)&&before_deadline(deadline); }
static int rule_matches(CFDictionaryRef rule) {
  if (!rule || CFGetTypeID(rule) != CFDictionaryGetTypeID()) return 0;
  CFTypeRef cls=CFDictionaryGetValue(rule,CFSTR("class")), group=CFDictionaryGetValue(rule,CFSTR("group")), timeout=CFDictionaryGetValue(rule,CFSTR("timeout"));
  long seconds=-1;
  return cls && CFEqual(cls,CFSTR("user")) && group && CFEqual(group,CFSTR("admin")) && timeout && CFGetTypeID(timeout)==CFNumberGetTypeID() && CFNumberGetValue(timeout,kCFNumberLongType,&seconds) && seconds==0 &&
    CFDictionaryGetValue(rule,CFSTR("authenticate-user"))==kCFBooleanTrue && CFDictionaryGetValue(rule,CFSTR("shared"))==kCFBooleanFalse && CFDictionaryGetValue(rule,CFSTR("allow-root"))==kCFBooleanFalse;
}
int main(int argc,char **argv) {
  if(getuid()!=0||geteuid()!=0)return 77;
  if(argc!=4||!argv[1][0]||argv[1][0]=='-'||!argv[2][0]||argv[2][0]=='-')return 64;
  char *end=NULL;errno=0;unsigned long raw=strtoul(argv[1],&end,10);
  if(errno||!end||*end||!raw||raw>UINT_MAX||!console_is((uid_t)raw))return 65;
  end=NULL;errno=0;unsigned long session=strtoul(argv[2],&end,10);
  if(errno||!end||*end||!session||session>=UINT_MAX)return 65;
  end=NULL;errno=0;unsigned long long deadline=strtoull(argv[3],&end,10);
  if(errno||!end||*end||!argv[3][0]||argv[3][0]=='-'||!deadline||deadline>9007199254740991ULL||!before_deadline(deadline))return 65;
  struct passwd *pw=getpwuid((uid_t)raw);if(!pw||pw->pw_uid!=(uid_t)raw||!strcmp(pw->pw_name,"_xiaok_verifier"))return 65;
  uid_t uid=pw->pw_uid;
  /* Keep root credentials: an ordinary same-UID worker must not be able to
   * debugger-inject approval into this process. launchctl asuser adopts only
   * bootstrap/audit-session context. The fixed right explicitly disallows a
   * root bypass and requires a new nonshared user authentication. */
  if(getuid()!=0||geteuid()!=0||!active_session(uid,(au_asid_t)session)||!before_deadline(deadline))return 77;
#if defined(XIAOK_APPLICATION_BINDING)
  size_t count=0;unsigned char *prompt=xiaok_read_application_review(STDIN_FILENO,&count);if(!prompt)return 65;
#else
#if defined(XIAOK_PUBLICATION_OPERATION) || defined(XIAOK_PROFILE_SOURCE)
  const size_t capacity=7*1024*1024+1;
#else
  const size_t capacity=65537;
#endif
  unsigned char *prompt=malloc(capacity);if(!prompt)return 65;size_t count=0;
  for(;;){ssize_t n=read(STDIN_FILENO,prompt+count,capacity-count);if(n<0)return 65;if(!n)break;count+=(size_t)n;if(count==capacity)return 65;}
  if(!count||memchr(prompt,0,count))return 65;prompt[count]=0;
#endif
  /* Parent supplies canonical escaped review; keep this prompt bounded and reject
   * controls that could hide/substitute scope text in the native security UI. */
  for(size_t i=0;i<count;i++)if((prompt[i]<32&&prompt[i]!='\n'&&prompt[i]!='\t')||prompt[i]>=127)return 65;
#if defined(XIAOK_PROFILE_SOURCE)
  const char *right="dev.xiaok.verification.profile-sources";
#elif defined(XIAOK_APPLICATION_BINDING)
  const char *right="dev.xiaok.verification.application";
#elif defined(XIAOK_ARCHIVE_OPERATION)
  const char *right="dev.xiaok.verification.archive";
#elif defined(XIAOK_PUBLICATION_OPERATION)
  const char *right="dev.xiaok.verification.publication";
#elif defined(XIAOK_OWNER_ENROLLMENT)
  const char *right="dev.xiaok.verification.enrollment";
#else
  const char *right="dev.xiaok.verification.materials";
#endif
  CFDictionaryRef rule=NULL;if(AuthorizationRightGet(right,&rule)!=errAuthorizationSuccess)return 77;
  int valid=rule_matches(rule);CFRelease(rule);if(!valid)return 77;
  #if defined(XIAOK_PROFILE_SOURCE)
  const char *purpose="profile-source-custody";
#elif defined(XIAOK_APPLICATION_BINDING)
  const char *purpose="completion-application-binding";
#elif defined(XIAOK_ARCHIVE_OPERATION)
  const char *purpose="execution-archive-access";
#elif defined(XIAOK_PUBLICATION_OPERATION)
  const char *purpose="completion-publication";
#elif defined(XIAOK_OWNER_ENROLLMENT)
  const char *purpose="completion-owner-enrollment";
#else
  const char *purpose="isolated-materials";
#endif
  if(!xiaok_review_panel(prompt,count,(unsigned int)uid,(unsigned int)session,(uint64_t)deadline,purpose,approval_current)||!approval_current(uid,(unsigned int)session,deadline))return 77;
  AuthorizationRef auth=NULL;
  if(AuthorizationCreate(NULL,kAuthorizationEmptyEnvironment,kAuthorizationFlagDefaults,&auth)!=errAuthorizationSuccess)return 77;
  const char *authenticationPrompt="Confirm the complete scope you reviewed in the protected xiaok approval window.";
  AuthorizationItem item={right,0,NULL,0}, environmentItem={kAuthorizationEnvironmentPrompt,strlen(authenticationPrompt),(void *)authenticationPrompt,0};
  AuthorizationRights rights={1,&item};AuthorizationEnvironment environment={1,&environmentItem};
  OSStatus result=AuthorizationCopyRights(auth,&rights,&environment,kAuthorizationFlagInteractionAllowed|kAuthorizationFlagExtendRights,NULL);
  AuthorizationFree(auth,kAuthorizationFlagDestroyRights);
  if(result!=errAuthorizationSuccess||getuid()!=0||geteuid()!=0||!active_session(uid,(au_asid_t)session)||!before_deadline(deadline))return 77;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CC_SHA256(prompt,(CC_LONG)count,digest);
#pragma clang diagnostic pop
  for(size_t i=0;i<sizeof(digest);i++)printf("%02x",digest[i]);putchar('\n');return 0;
}
