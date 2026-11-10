#ifndef XIAOK_INSTALLATION_CLOSURE_H
#define XIAOK_INSTALLATION_CLOSURE_H
#include "protocol.h"
#ifndef MI_HELPER_EXEC
#define MI_HELPER_EXEC MI_FIXED_ROOT "/main-installation-helper"
#endif
#ifndef MI_CERTIFIER_EXEC
#define MI_CERTIFIER_EXEC MI_FIXED_ROOT "/main-installation-certifier"
#endif
#ifndef MI_SIGNING_TEAM_ID
#define MI_SIGNING_TEAM_ID "Y9YR86UG94"
#endif
#ifndef MI_SIGNING_BUNDLE_ID
#define MI_SIGNING_BUNDLE_ID "com.xiaok.desktop"
#endif
static __attribute__((unused)) int identity(const struct stat *a,const struct stat *b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_uid==b->st_uid&&a->st_mode==b->st_mode&&a->st_nlink==b->st_nlink;}
static __attribute__((unused)) int directory_identity(const struct stat *a,const struct stat *b){return S_ISDIR(a->st_mode)&&S_ISDIR(b->st_mode)&&a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_uid==b->st_uid&&a->st_mode==b->st_mode;}
static __attribute__((unused)) int safe_acl(int fd);
static __attribute__((unused)) int regular_owned(int fd,uid_t uid,struct stat *s){return !fstat(fd,s)&&S_ISREG(s->st_mode)&&s->st_uid==uid&&s->st_nlink==1&&(s->st_mode&0777)==0600&&safe_acl(fd);}
static __attribute__((unused)) int safe_acl(int fd){
#ifdef __APPLE__
 acl_t acl=acl_get_fd_np(fd,ACL_TYPE_EXTENDED);if(!acl)return errno==ENOENT;
 int good=acl_valid_fd_np(fd,ACL_TYPE_EXTENDED,acl)==0,ended=0;
 /* Darwin returns zero for an entry and EINVAL at the end of a valid ACL. */
 for(int index=0;good&&index<=ACL_MAX_ENTRIES;index++){
  acl_entry_t entry;errno=0;if(acl_get_entry(acl,index,&entry)!=0){ended=errno==EINVAL;good=ended;break;}
  if(index==ACL_MAX_ENTRIES){good=0;break;}
  acl_tag_t tag;acl_permset_t permissions;if(acl_get_tag_type(entry,&tag)||acl_get_permset(entry,&permissions)||(tag!=ACL_EXTENDED_ALLOW&&tag!=ACL_EXTENDED_DENY)){good=0;break;}
  if(tag==ACL_EXTENDED_ALLOW){const acl_perm_t writing[]={ACL_WRITE_DATA,ACL_APPEND_DATA,ACL_DELETE,ACL_WRITE_ATTRIBUTES,ACL_WRITE_EXTATTRIBUTES,ACL_WRITE_SECURITY,ACL_CHANGE_OWNER,ACL_DELETE_CHILD};for(size_t i=0;i<sizeof(writing)/sizeof(writing[0]);i++)if(acl_get_perm_np(permissions,writing[i])!=0){good=0;break;}}
 }
 if(!ended)good=0;if(acl_free(acl))good=0;return good;
#else
 (void)fd;return 0;
#endif
}
static __attribute__((unused)) int checked_chain(const char *path,int protected_chain){
 if(!path||path[0]!='/'||strlen(path)>=PATH_MAX)return -1;char copy[PATH_MAX];memcpy(copy,path,strlen(path)+1);
 int dir=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return -1;char *save=NULL;
 for(char *part=strtok_r(copy,"/",&save);part;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,"..")){close(dir);return -1;}int next=openat(dir,part,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);struct stat s;
  if(next<0||fstat(next,&s)||(protected_chain&&(s.st_uid!=0||(s.st_mode&0022)||!safe_acl(next)))){if(next>=0)close(next);close(dir);return -1;}close(dir);dir=next;
 }return dir;
}
#ifdef MI_FIXTURE_BUILD
static __attribute__((unused)) int hex_digest(const char *s,unsigned char out[32]){if(strlen(s)!=64)return 0;for(size_t i=0;i<32;i++){unsigned v=0;for(size_t j=0;j<2;j++){unsigned char c=(unsigned char)s[2*i+j];unsigned n=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:16;if(n==16)return 0;v=v*16+n;}out[i]=(unsigned char)v;}return 1;}
#endif
static __attribute__((unused)) int hash_file(const char *path,unsigned char out[32],struct stat *actual){
#ifdef __APPLE__
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return 0;struct stat before,after,path_after;int good=!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_nlink==1&&before.st_size>=0;CC_SHA256_CTX c;CC_SHA256_Init(&c);unsigned char bytes[65536];off_t total=0;
 while(good){ssize_t n=read(fd,bytes,sizeof(bytes));if(n>0){total+=n;if(total>before.st_size){good=0;break;}CC_SHA256_Update(&c,bytes,(CC_LONG)n);}else if(!n)break;else if(errno!=EINTR)good=0;}
 if(good)good=total==before.st_size&&!fstat(fd,&after)&&!lstat(path,&path_after)&&identity(&before,&after)&&identity(&after,&path_after)&&before.st_size==after.st_size&&before.st_mtimespec.tv_sec==after.st_mtimespec.tv_sec&&before.st_mtimespec.tv_nsec==after.st_mtimespec.tv_nsec;
 if(close(fd))good=0;if(good){CC_SHA256_Final(out,&c);*actual=after;}mi_zero(bytes,sizeof(bytes));mi_zero(&c,sizeof(c));return good;
#else
 (void)path;(void)out;(void)actual;return 0;
#endif
}
#ifndef MI_FIXTURE_BUILD
static __attribute__((unused)) int read_account_generation(uint32_t uid,unsigned char collected[36]){
#ifdef __APPLE__
 struct passwd pwd,*actual=NULL;char account[16384];if(getpwuid_r((uid_t)uid,&pwd,account,sizeof(account),&actual)||!actual||pwd.pw_uid!=(uid_t)uid)return 0;
 CFErrorRef error=NULL;ODSessionRef session=ODSessionCreate(NULL,NULL,&error);ODNodeRef node=NULL;ODRecordRef record=NULL;CFArrayRef values=NULL;CFStringRef name=CFStringCreateWithCString(NULL,pwd.pw_name,kCFStringEncodingUTF8);int good=session&&name;
 if(good){node=ODNodeCreateWithName(NULL,session,CFSTR("/Local/Default"),&error);good=node!=NULL;}
 if(good){record=ODNodeCopyRecord(node,kODRecordTypeUsers,name,NULL,&error);good=record!=NULL;}
 if(good){values=ODRecordCopyValues(record,kODAttributeTypeGUID,&error);good=values&&CFArrayGetCount(values)==1;}
 if(good){CFTypeRef value=CFArrayGetValueAtIndex(values,0);char guid[37];good=CFGetTypeID(value)==CFStringGetTypeID()&&CFStringGetCString(value,guid,sizeof(guid),kCFStringEncodingASCII)&&strlen(guid)==36;if(good)memcpy(collected,guid,36);}
 if(values)CFRelease(values);if(record)CFRelease(record);if(node)CFRelease(node);if(name)CFRelease(name);if(session)CFRelease(session);if(error)CFRelease(error);return good;
#else
 (void)uid;(void)collected;return 0;
#endif
}
static __attribute__((unused)) int account_generation(uint32_t uid,const unsigned char expected[36]){unsigned char actual[36];return read_account_generation(uid,actual)&&!memcmp(actual,expected,36);}
static __attribute__((unused)) int protected_launcher(void){
 char parent[PATH_MAX];size_t length=strlen(MI_LAUNCHER_EXEC);if(!length||length>=sizeof(parent))return 0;memcpy(parent,MI_LAUNCHER_EXEC,length+1);char *slash=strrchr(parent,'/');if(!slash||slash==parent)return 0;*slash=0;
 int directory=checked_chain(parent,1);if(directory<0)return 0;int fd=openat(directory,slash+1,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);struct stat actual;int good=fd>=0&&!fstat(fd,&actual)&&S_ISREG(actual.st_mode)&&actual.st_uid==0&&actual.st_nlink==1&&!(actual.st_mode&0022)&&(actual.st_mode&0111)&&safe_acl(fd);if(fd>=0&&close(fd))good=0;if(close(directory))good=0;return good;
}

#endif

#endif
