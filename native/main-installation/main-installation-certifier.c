#define _DARWIN_C_SOURCE
#include "wire.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <pwd.h>
#include <dirent.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <OpenDirectory/OpenDirectory.h>
#include <sys/acl.h>
#include <bsm/audit.h>
#include <libproc.h>
#endif
#ifndef __APPLE__
int main(int argc,char **argv){(void)argv;if(argc!=1)return 64;fputs("MI_CERTIFIER_PLATFORM_UNAVAILABLE\n",stderr);return 77;}
#else
#if (defined(MI_CERTIFICATE_STOP_PHASE)||defined(MI_CERTIFICATE_COMPONENT_BARRIER))&&!defined(MI_INSTALLATION_CERT_COMPONENT_BUILD)
#error CERTIFIER_FAULT_IS_COMPONENT_ONLY
#endif
/* Strong local ownership precedes every SDK. No callback/JS/native role surface. */
typedef struct certifier {
 int root,file,entered,published,first_error,unknown;
 int failed_close_fds[16],failed_close_codes[16],failed_close_count,closing_fd;
 struct stat directory;
 uint32_t uid,audit_session;
 unsigned char guid[36],release[32],main_hash[32],bytes[120];
 struct stat main_identity;
} certifier;
static void first_error(certifier *s,int fallback){if(!s->first_error)s->first_error=errno?errno:fallback;if(s->entered)s->unknown=1;}
static certifier *active_certifier;
static int (*const actual_close_sdk)(int)=close;
static int certifier_close_leaf(int fd){
 int code=actual_close_sdk(fd);if(code&&active_certifier){certifier *s=active_certifier;int saved=errno?errno:EIO;s->unknown=1;if(!s->first_error)s->first_error=saved;if(s->failed_close_count<16){size_t n=(size_t)s->failed_close_count++;s->failed_close_fds[n]=fd;s->failed_close_codes[n]=saved;}errno=saved;}return code;
}
#pragma push_macro("close")
#undef close
#define close certifier_close_leaf
#include "installation-certificate.h"
#undef close
#pragma pop_macro("close")
static int close_slot(certifier *s,int *slot){if(*slot<0)return 1;int actual=*slot;*slot=-1;s->closing_fd=actual;int result=certifier_close_leaf(actual);s->closing_fd=-1;return result==0;}
static int actor(uint32_t *uid,uint32_t *session){
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
 *session=0;*uid=(uint32_t)getuid();return *uid>0&&getuid()==geteuid();
#else
 if(getuid()!=0||geteuid()!=0)return 0;
 au_id_t first;struct auditinfo_addr actual;memset(&actual,0,sizeof(actual));
 if(getauid(&first)||getaudit_addr(&actual,sizeof(actual))||first==0||first==AU_DEFAUDITID||first!=actual.ai_auid||actual.ai_asid==0)return 0;
 *uid=(uint32_t)first;*session=(uint32_t)actual.ai_asid;return 1;
#endif
}
static int directory_current(certifier *s){if(s->unknown)return 0;struct stat held,named;return !fstat(s->root,&held)&&!lstat(MI_FIXED_ROOT,&named)&&directory_identity(&held,&s->directory)&&directory_identity(&held,&named)&&safe_acl(s->root);}
static int collect(certifier *s){
 if(s->unknown)return 0;uint32_t uid,session;unsigned char guid[36];if(!actor(&uid,&session)||uid!=s->uid||session!=s->audit_session||!read_account_generation(uid,guid)||!mi_guid_shape(guid))return 0;
 if(s->guid[0]&&memcmp(s->guid,guid,36))return 0;memcpy(s->guid,guid,36);
 uid_t owner;
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
 owner=getuid();
#else
 owner=0;if(!mi_running_image(MI_CERTIFIER_EXEC)||!signed_bundle()||!protected_launcher()||!mi_signed_installation_components())return 0;
#endif
 if(!mi_release_digest(s->release,&s->main_identity,owner)||!hash_file(MI_MAIN_EXEC,s->main_hash,&s->main_identity))return 0;
 return !s->unknown&&directory_current(s);
}
static int named_absent(certifier *s,const char *name){struct stat actual;if(fstatat(s->root,name,&actual,AT_SYMLINK_NOFOLLOW)==0){errno=EEXIST;return 0;}if(errno==ENOENT){errno=0;return 1;}return 0;}
static int component_phase(int phase){
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
#ifdef MI_CERTIFICATE_STOP_PHASE
 if(phase==MI_CERTIFICATE_STOP_PHASE)_exit(91);
#endif
#else
 (void)phase;
#endif
 (void)phase;return 1;
}
int main(int argc,char **argv){
 (void)argv;if(argc!=1){fputs("MI_CERTIFIER_ARGUMENT_INVALID\n",stderr);return 64;}
#ifndef __APPLE__
 fputs("MI_CERTIFIER_PLATFORM_UNAVAILABLE\n",stderr);return 77;
#else
#ifndef MI_INSTALLATION_CERT_COMPONENT_BUILD
 if(getuid()!=0||geteuid()!=0){fputs("MI_CERTIFIER_PRIVILEGE_REQUIRED\n",stderr);return 77;}
#endif
 certifier s;memset(&s,0,sizeof(s));s.root=s.file=s.closing_fd=-1;active_certifier=&s;const char *reason="MI_CERTIFIER_ACTOR_UNCONFIRMED";int success=0;
 if(!actor(&s.uid,&s.audit_session))goto done;
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
 s.root=checked_chain(MI_FIXED_ROOT,0);uid_t owner=getuid();
#else
 s.root=checked_chain(MI_FIXED_ROOT,1);uid_t owner=0;
#endif
 reason="MI_CERTIFIER_ROOT_UNCONFIRMED";
 if(s.root<0||fstat(s.root,&s.directory)||s.directory.st_uid!=owner||(s.directory.st_mode&0022)||!safe_acl(s.root))goto done;
 reason="MI_CERTIFIER_ALREADY_PRESENT";if(!named_absent(&s,"installation.bin")){s.unknown=1;goto done;}
 reason="MI_CERTIFIER_INCOMPLETE";if(!named_absent(&s,"installation.bin.pending")){s.unknown=1;goto done;}
 reason="MI_CERTIFIER_CLOSURE_UNCONFIRMED";errno=0;if(!collect(&s))goto done;
 mi_certificate_encode(s.bytes,s.uid,s.release,s.main_hash,s.guid);
#ifdef MI_CERTIFICATE_COMPONENT_BARRIER
 if(write(STDOUT_FILENO,"READY\n",6)!=6)goto done;unsigned char go;if(read(STDIN_FILENO,&go,1)!=1||go!='G')goto done;
#endif
 reason="MI_CERTIFIER_PUBLISH_UNKNOWN";if(!directory_current(&s))goto done;
 s.entered=1;s.file=openat(s.root,"installation.bin.pending",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(s.file<0)goto done;struct stat original;if(fstat(s.file,&original)||!S_ISREG(original.st_mode)||original.st_uid!=owner||original.st_nlink!=1||(original.st_mode&0777)!=0600||!safe_acl(s.file))goto done;
 component_phase(1);
 if(!mi_write_exact(s.file,s.bytes,sizeof(s.bytes),mi_now_ms()+1000))goto done;
 component_phase(2);
 if(fsync(s.file)||!close_slot(&s,&s.file))goto done;
 component_phase(3);
 unsigned char prior_release[32],prior_main[32];memcpy(prior_release,s.release,32);memcpy(prior_main,s.main_hash,32);
 if(!collect(&s)||memcmp(prior_release,s.release,32)||memcmp(prior_main,s.main_hash,32))goto done;
 struct stat pending;if(fstatat(s.root,"installation.bin.pending",&pending,AT_SYMLINK_NOFOLLOW)||!identity(&original,&pending)||pending.st_size!=120||!named_absent(&s,"installation.bin"))goto done;
 if(renameatx_np(s.root,"installation.bin.pending",s.root,"installation.bin",RENAME_EXCL))goto done;s.published=1;
 component_phase(4);
 if(fsync(s.root)||s.unknown)goto done;success=1;
 done:
 if(!success)first_error(&s,EPERM);
 if(!close_slot(&s,&s.file))success=0;if(!close_slot(&s,&s.root))success=0;
 if(!success){for(int n=0;n<s.failed_close_count;n++)fprintf(stderr,"MI_CERTIFIER_FAILED_CLOSE:fd=%d:errno=%d\n",s.failed_close_fds[n],s.failed_close_codes[n]);fprintf(stderr,"%s:errno=%d:unknown=%d:published=%d:pending=%s/installation.bin.pending\n",reason,s.first_error,s.unknown,s.published,MI_FIXED_ROOT);active_certifier=NULL;mi_zero(&s,sizeof(s));return 78;}
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
 puts("MI_CERTIFIER_COMPONENT_WRITTEN_NOT_PRODUCTION");
#else
 puts("MI_INSTALLATION_CERTIFICATE_WRITTEN_NOT_GENESIS");
#endif
 active_certifier=NULL;mi_zero(&s,sizeof(s));return 0;
#endif
}

#endif /* Darwin-only certifier implementation. */
