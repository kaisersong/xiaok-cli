#ifndef XIAOK_INSTALLATION_RELEASE_H
#define XIAOK_INSTALLATION_RELEASE_H
#ifdef __APPLE__
/* Same private closure predicates, extended with a versioned deterministic digest.
 * No argv/env identity, callback verifier, path API or JS export exists. */
#include "installation-closure.h"
static __attribute__((unused)) void mi_digest_u32(CC_SHA256_CTX *hash,uint32_t value){unsigned char b[4]={(unsigned char)(value>>24),(unsigned char)(value>>16),(unsigned char)(value>>8),(unsigned char)value};CC_SHA256_Update(hash,b,4);}
static __attribute__((unused)) void mi_digest_bytes(CC_SHA256_CTX *hash,const void *bytes,size_t size){mi_digest_u32(hash,(uint32_t)size);if(size)CC_SHA256_Update(hash,bytes,(CC_LONG)size);}
static __attribute__((unused)) int mi_name_compare(const void *a,const void *b){return strcmp(*(char *const*)a,*(char *const*)b);}
static __attribute__((unused)) int mi_release_tree(int directory,const char *path,const char *base,unsigned depth,size_t *count,uid_t owner,CC_SHA256_CTX *hash){
 if(depth>64)return 0;int copy=fcntl(directory,F_DUPFD_CLOEXEC,3);if(copy<0)return 0;DIR *stream=fdopendir(copy);if(!stream){close(copy);return 0;}
 char **names=NULL;size_t length=0;int good=1;struct dirent *entry;
 while(good){errno=0;entry=readdir(stream);if(!entry){if(errno)good=0;break;}if(!strcmp(entry->d_name,".")||!strcmp(entry->d_name,".."))continue;if(++*count>100000){good=0;break;}char **next=realloc(names,(length+1)*sizeof(*names));if(!next){good=0;break;}names=next;names[length]=strdup(entry->d_name);if(!names[length]){good=0;break;}length++;}
 if(closedir(stream))good=0;if(good)qsort(names,length,sizeof(*names),mi_name_compare);
 for(size_t index=0;good&&index<length;index++){
  const char *name=names[index];struct stat before,after;char child[PATH_MAX];int n=snprintf(child,sizeof(child),"%s/%s",path,name);
  if(n<0||(size_t)n>=sizeof(child)||fstatat(directory,name,&before,AT_SYMLINK_NOFOLLOW)||before.st_uid!=owner){good=0;break;}
  const char *relative=child+strlen(base);mi_digest_bytes(hash,relative,strlen(relative));mi_digest_u32(hash,(uint32_t)before.st_mode);
  if(S_ISLNK(before.st_mode)){
   char canonical[PATH_MAX],target[PATH_MAX];size_t base_length=strlen(base);ssize_t size=readlinkat(directory,name,target,sizeof(target));
   if(before.st_nlink!=1||size<0||(size_t)size>=sizeof(target)||!realpath(child,canonical)||strncmp(canonical,base,base_length)||(canonical[base_length]&&canonical[base_length]!='/')||fstatat(directory,name,&after,AT_SYMLINK_NOFOLLOW)||!identity(&before,&after)){good=0;break;}
   mi_digest_bytes(hash,target,(size_t)size);continue;
  }
  if((before.st_mode&0022)||(!S_ISDIR(before.st_mode)&&(!S_ISREG(before.st_mode)||before.st_nlink!=1))){good=0;break;}
  int fd=openat(directory,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|(S_ISDIR(before.st_mode)?O_DIRECTORY:0));
  if(fd<0||fstat(fd,&after)||!identity(&before,&after)||!safe_acl(fd)){if(fd>=0)close(fd);good=0;break;}
  if(S_ISDIR(before.st_mode))good=mi_release_tree(fd,child,base,depth+1,count,owner,hash);
  else{unsigned char digest[32];struct stat hashed;good=hash_file(child,digest,&hashed)&&identity(&hashed,&before);if(good)mi_digest_bytes(hash,digest,sizeof(digest));}
  if(close(fd))good=0;
 }
 for(size_t index=0;index<length;index++)free(names[index]);free(names);return good;
}
#ifndef MI_FIXTURE_BUILD
static __attribute__((unused)) int mi_signed_path(const char *path,const char *identifier,int bundle){
 CFURLRef url=CFURLCreateFromFileSystemRepresentation(NULL,(const UInt8*)path,strlen(path),bundle);SecStaticCodeRef code=NULL;CFDictionaryRef info=NULL;CFStringRef expected=CFStringCreateWithCString(NULL,identifier,kCFStringEncodingASCII);
 int good=url&&expected&&SecStaticCodeCreateWithPath(url,kSecCSDefaultFlags,&code)==errSecSuccess;
 if(good)good=SecStaticCodeCheckValidity(code,kSecCSStrictValidate|kSecCSCheckAllArchitectures|kSecCSCheckNestedCode,NULL)==errSecSuccess;
 if(good)good=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info)==errSecSuccess;
 if(good){CFTypeRef team=CFDictionaryGetValue(info,kSecCodeInfoTeamIdentifier),id=CFDictionaryGetValue(info,kSecCodeInfoIdentifier),flags=CFDictionaryGetValue(info,kSecCodeInfoFlags);int32_t bits=0;good=team&&id&&flags&&CFGetTypeID(team)==CFStringGetTypeID()&&CFGetTypeID(id)==CFStringGetTypeID()&&CFGetTypeID(flags)==CFNumberGetTypeID()&&CFEqual(team,CFSTR(MI_SIGNING_TEAM_ID))&&CFEqual(id,expected)&&CFNumberGetValue(flags,kCFNumberSInt32Type,&bits)&&(bits&kSecCodeSignatureRuntime);}
 if(good){CFTypeRef ent=CFDictionaryGetValue(info,kSecCodeInfoEntitlementsDict);const CFStringRef bad[]={CFSTR("com.apple.security.get-task-allow"),CFSTR("com.apple.security.cs.disable-library-validation")};if(ent&&CFGetTypeID(ent)!=CFDictionaryGetTypeID())good=0;for(size_t i=0;good&&ent&&i<2;i++){CFTypeRef value=CFDictionaryGetValue(ent,bad[i]);if(value&&CFEqual(value,kCFBooleanTrue))good=0;}}
 if(info)CFRelease(info);if(code)CFRelease(code);if(expected)CFRelease(expected);if(url)CFRelease(url);return good;
}
static __attribute__((unused)) int mi_running_image(const char *fixed){
 char executable[PROC_PIDPATHINFO_MAXSIZE];if(proc_pidpath((int)getpid(),executable,sizeof(executable))<=0||strcmp(executable,fixed))return 0;
 SecCodeRef running=NULL;SecStaticCodeRef installed=NULL;CFDictionaryRef live_info=NULL,file_info=NULL;CFURLRef url=CFURLCreateFromFileSystemRepresentation(NULL,(const UInt8*)fixed,strlen(fixed),false);
 int good=url&&SecCodeCopySelf(kSecCSDefaultFlags,&running)==errSecSuccess&&SecStaticCodeCreateWithPath(url,kSecCSDefaultFlags,&installed)==errSecSuccess;
 if(good)good=SecCodeCopySigningInformation(running,kSecCSSigningInformation,&live_info)==errSecSuccess&&SecCodeCopySigningInformation(installed,kSecCSSigningInformation,&file_info)==errSecSuccess;
 if(good){CFTypeRef a=CFDictionaryGetValue(live_info,kSecCodeInfoUnique),b=CFDictionaryGetValue(file_info,kSecCodeInfoUnique);good=a&&b&&CFGetTypeID(a)==CFDataGetTypeID()&&CFGetTypeID(b)==CFDataGetTypeID()&&CFDataGetLength(a)>0&&CFEqual(a,b);}
 if(live_info)CFRelease(live_info);if(file_info)CFRelease(file_info);if(running)CFRelease(running);if(installed)CFRelease(installed);if(url)CFRelease(url);return good;
}
static __attribute__((unused)) int signed_bundle(void){return mi_signed_path(MI_MAIN_BUNDLE,MI_SIGNING_BUNDLE_ID,1);}
static __attribute__((unused)) int mi_signed_installation_components(void){return mi_signed_path(MI_HELPER_EXEC,"com.xiaok.main-installation-helper",0)&&mi_signed_path(MI_LAUNCHER_EXEC,"com.xiaok.main-installation-entry",0)&&mi_signed_path(MI_CERTIFIER_EXEC,"com.xiaok.main-installation-certifier",0);}

#endif
static __attribute__((unused)) int mi_release_digest(unsigned char out[32],struct stat *main_identity,uid_t owner){
 CC_SHA256_CTX hash;CC_SHA256_Init(&hash);static const char domain[]="xiaok-installation-release-closure-v1";CC_SHA256_Update(&hash,domain,sizeof(domain));
 int root=checked_chain(MI_MAIN_BUNDLE,owner==0);char canonical[PATH_MAX];size_t count=0;
 int good=root>=0&&realpath(MI_MAIN_BUNDLE,canonical)&&mi_release_tree(root,canonical,canonical,0,&count,owner,&hash);if(root>=0&&close(root))good=0;
 const char *paths[]={MI_MAIN_EXEC,MI_HELPER_EXEC,MI_LAUNCHER_EXEC,MI_CERTIFIER_EXEC};
 for(size_t i=0;good&&i<4;i++){unsigned char digest[32];struct stat actual;int fd=open(paths[i],O_RDONLY|O_CLOEXEC|O_NOFOLLOW);struct stat held;good=fd>=0&&!fstat(fd,&held)&&safe_acl(fd)&&hash_file(paths[i],digest,&actual)&&identity(&held,&actual)&&actual.st_uid==owner&&!(actual.st_mode&0022)&&(actual.st_mode&0111);if(fd>=0&&close(fd))good=0;if(good){mi_digest_u32(&hash,(uint32_t)i);mi_digest_bytes(&hash,digest,32);if(i==0)*main_identity=actual;}}
 if(good)CC_SHA256_Final(out,&hash);mi_zero(&hash,sizeof(hash));return good;
}
#endif /* __APPLE__: unsupported platforms never receive Native release facts. */
#endif
