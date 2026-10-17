/* Cooperative source writer custody. This leaf must run as the original user,
 * never root. Marker cleanup remains the original user's stale-lock protocol. */
#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <limits.h>
#include <poll.h>
#define MAX_SOURCES 64
struct held {int directory;char *path;const char *name;dev_t device;ino_t inode;struct stat marker;char bytes[2048];size_t size;};
static int number(const char *s,unsigned long long *v){if(!s||!*s||(*s=='0'&&s[1]))return 0;for(const char *p=s;*p;p++)if(*p<'0'||*p>'9')return 0;char *end;errno=0;*v=strtoull(s,&end,10);return !errno&&!*end;}
static int directory(const char *path){
 if(!path||path[0]!='/'||strlen(path)>4096)return -1;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0||!path[1])return fd;
 char *copy=strdup(path+1);if(!copy){close(fd);return -1;}char *part=copy;unsigned count=0;
 for(;;){char *slash=strchr(part,'/');if(slash)*slash=0;if(!*part||!strcmp(part,".")||!strcmp(part,"..")||++count>64){close(fd);fd=-1;break;}int next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;if(fd<0||!slash)break;part=slash+1;}
 free(copy);return fd;
}
static int root_current(struct held *h){int fd=directory(h->path);if(fd<0)return 0;struct stat s;int okay=!fstat(fd,&s)&&s.st_dev==h->device&&s.st_ino==h->inode;close(fd);return okay;}
static int random_uuid(char out[37]){unsigned char b[16];arc4random_buf(b,sizeof(b));b[6]=(unsigned char)((b[6]&15)|64);b[8]=(unsigned char)((b[8]&63)|128);snprintf(out,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);return 1;}
static int write_all(int fd,const char *bytes,size_t size){while(size){ssize_t n=write(fd,bytes,size);if(n<0&&errno==EINTR)continue;if(n<=0)return 0;bytes+=n;size-=(size_t)n;}return 1;}
static int command(char line[PATH_MAX*2+128]){for(size_t i=0;i<PATH_MAX*2+127;i++){struct pollfd p={STDIN_FILENO,POLLIN,0};int ready=poll(&p,1,i?5000:300000);if(ready<=0)return -1;ssize_t n=read(STDIN_FILENO,line+i,1);if(n==0)return 0;if(n<0)return -1;if(line[i]=='\n'){line[i+1]=0;return 1;}}return -1;}
static int current(struct held *h){
 if(!root_current(h))return 0;if(!*h->name)return 1;int fd=openat(h->directory,h->name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0)return 0;struct stat s;int okay=!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_dev==h->marker.st_dev&&s.st_ino==h->marker.st_ino&&s.st_size==(off_t)h->size&&s.st_nlink==1&&s.st_uid==getuid();char bytes[2048];size_t got=0;
 while(okay&&got<h->size){ssize_t n=read(fd,bytes+got,h->size-got);if(n<0&&errno==EINTR)continue;if(n<=0){okay=0;break;}got+=(size_t)n;}okay=okay&&!memcmp(bytes,h->bytes,h->size);close(fd);return okay&&root_current(h);
}
static int acquire(struct held *h,const char *hostname,const char *nonce){
 if(!*h->name)return current(h);
 char temp[NAME_MAX+1];int n=snprintf(temp,sizeof(temp),"%s.%s.tmp",h->name,nonce);if(n<0||(size_t)n>=sizeof(temp))return 0;
 n=snprintf(h->bytes,sizeof(h->bytes),"{\"version\":1,\"pid\":%ld,\"hostname\":\"%s\",\"nonce\":\"%s\"}",(long)getpid(),hostname,nonce);if(n<0||(size_t)n>=sizeof(h->bytes))return 0;h->size=(size_t)n;
 int fd=openat(h->directory,temp,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return 0;
 int okay=write_all(fd,h->bytes,h->size)&&!fchmod(fd,0600)&&!fsync(fd)&&!fstat(fd,&h->marker);
 if(okay)okay=!linkat(h->directory,temp,h->directory,h->name,0);
 /* This process is permanently unprivileged. Even temp cleanup checks the
  * original inode; it never deletes a marker, including partial acquisition. */
 struct stat tempstat;if(!fstatat(h->directory,temp,&tempstat,AT_SYMLINK_NOFOLLOW)&&tempstat.st_dev==h->marker.st_dev&&tempstat.st_ino==h->marker.st_ino){if(unlinkat(h->directory,temp,0))okay=0;}else okay=0;
 close(fd);if(fsync(h->directory))okay=0;return okay&&current(h);
}
#include "source-session-locks.h"
#include "source-directory-capture.h"
int main(int argc,char **argv){
 unsigned long long uid;if(argc<6||(argc-2)%4||(argc-2)/4>MAX_SOURCES||!number(argv[1],&uid)||uid==0||uid>UINT_MAX)return 64;
 if(getuid()==0||geteuid()!=getuid()||(unsigned long long)getuid()!=uid)return 77;
 struct held sources[MAX_SOURCES];memset(sources,0,sizeof(sources));int count=(argc-2)/4,opened=0,result=65;char nonce[37],host[256],escaped[1536];if(!random_uuid(nonce)||gethostname(host,sizeof(host)))return 65;host[sizeof(host)-1]=0;
 size_t offset=0;for(size_t i=0;host[i];i++){unsigned char c=(unsigned char)host[i];if(c<' '||c=='"'||c=='\\'){int n=snprintf(escaped+offset,sizeof(escaped)-offset,"\\u%04x",c);if(n<0||(size_t)n>=sizeof(escaped)-offset)return 65;offset+=(size_t)n;}else{if(offset+1>=sizeof(escaped))return 65;escaped[offset++]=(char)c;}}escaped[offset]=0;
 for(int i=0;i<count;i++){
  const char *kind=argv[2+i*4];struct held *h=&sources[i];h->name=!strcmp(kind,"session-alias-holder")?"":!strcmp(kind,"profile-registry")?".profile-source-registry.lock":!strcmp(kind,"session-root")?".session-store-lock":!strcmp(kind,"task-root")?".task-store.save.lock":!strcmp(kind,"goal-file-root")?".goal-store.save.lock":NULL;unsigned long long dev,ino;if(!h->name||!number(argv[4+i*4],&dev)||!number(argv[5+i*4],&ino)||!ino)goto end;
  h->path=argv[3+i*4];if(!*h->name){const char *base=strrchr(h->path,'/');if(!base||strcmp(base+1,".canonical-session-aliases"))goto end;}h->directory=directory(h->path);if(h->directory<0)goto end;opened++;struct stat stat;if(fstat(h->directory,&stat)||(unsigned long long)stat.st_dev!=dev||(unsigned long long)stat.st_ino!=ino)goto end;h->device=stat.st_dev;h->inode=stat.st_ino;
  for(int j=0;j<i;j++)if(sources[j].device==h->device&&sources[j].inode==h->inode&&!strcmp(sources[j].name,h->name))goto end;
  if(!acquire(h,escaped,nonce))goto end;
 }
 if(!sl_begin(sources,count,escaped,nonce))goto end;
 setvbuf(stdout,NULL,_IONBF,0);printf("{\"state\":\"held\",\"pid\":%ld,\"nonce\":\"%s\",\"count\":%d}\n",(long)getpid(),nonce,count);
 for(;;){char line[PATH_MAX*2+128];int received=command(line);if(received<=0){result=received==0?0:65;goto end;}if(strncmp(line,"BUDGET ",7)&&strncmp(line,"REFERENCE ",10)&&strcmp(line,"REFERENCES-END\n")&&strcmp(line,"CHECK\n")&&strcmp(line,"RELEASE\n")&&strcmp(line,"CAPTURE\n")&&strcmp(line,"NEXT\n"))goto end;for(int i=0;i<count;i++)if(!current(&sources[i]))goto end;if(!sl_current()||(dc_started&&!dc_current()))goto end;if(!strncmp(line,"BUDGET ",7)){unsigned long long limit;char value[21],extra;int end=0;if(dc_budget_set||dc_started||dc_memory||sscanf(line,"BUDGET %20s%n%c",value,&end,&extra)!=2||extra!='\n'||line[end+1]||!number(value,&limit)||limit>DC_LIMIT)goto end;dc_metadata_limit=(size_t)limit;dc_budget_set=1;printf("{\"state\":\"budget\",\"nonce\":\"%s\"}\n",nonce);continue;}if(!strncmp(line,"REFERENCE ",10)){if(!dc_reference_add(line,count,nonce))goto end;continue;}if(!strcmp(line,"REFERENCES-END\n")){if(dc_started||dc_references_sealed)goto end;dc_references_sealed=1;printf("{\"state\":\"references-sealed\",\"nonce\":\"%s\"}\n",nonce);continue;}if(!strcmp(line,"CAPTURE\n")){if(!dc_begin(sources,count,nonce))goto end;continue;}if(!strcmp(line,"NEXT\n")){if(!dc_next(nonce))goto end;continue;}if(!strcmp(line,"RELEASE\n")){puts("{\"state\":\"ending\"}");result=0;goto end;}printf("{\"state\":\"held\",\"pid\":%ld,\"nonce\":\"%s\",\"count\":%d}\n",(long)getpid(),nonce,count);}
 end:dc_close();sl_close();for(int i=0;i<opened;i++)close(sources[i].directory);return result;
}
