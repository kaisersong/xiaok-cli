#ifndef XIAOK_ENROLLMENT_CUSTODY_CHANNEL_H
#define XIAOK_ENROLLMENT_CUSTODY_CHANNEL_H
/* Fixed Native birth and descriptor transport only. Neither a channel nor its
 * bytes grants Source/approval/adoption/BOUND. No JS FD, PID or seed input. */
#ifdef __APPLE__
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pwd.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <libproc.h>
#define MI_CUSTODY_SOURCE_FD 3
#define MI_CUSTODY_HELPER_FD 197
#define MI_CUSTODY_BIRTH_BYTES 112
#define MI_CUSTODY_TRANSFER_BYTES 200
#define MI_CUSTODY_PARENT_NAME "broker-mainroot-activation-custody"
#define MI_CU_UNUSED __attribute__((unused))
typedef struct mi_custody_birth {
 uint32_t kind,role,uid,parent_uid,parent_pid,child_pid;
 uint64_t parent_sec,parent_usec,child_sec,child_usec;
 unsigned char nonce[32];
} mi_custody_birth;
typedef struct mi_custody_received {
 int entered,unknown,first_error_present,first_errno,closed;
 int fds[16],failed_fds[16],failed_codes[16],failed_count;
 struct stat facts[3];unsigned char ledger_digest[32],pool_id[32];
} mi_custody_received;
static MI_CU_UNUSED void mi_cu_init(mi_custody_received *r){memset(r,0,sizeof(*r));for(int i=0;i<16;i++)r->fds[i]=-1;}
static MI_CU_UNUSED uint32_t mi_cu_u32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static MI_CU_UNUSED uint64_t mi_cu_u64(const unsigned char *p){uint64_t v=0;for(int i=0;i<8;i++)v=v<<8|p[i];return v;}
static MI_CU_UNUSED void mi_cu_p32(unsigned char *p,uint32_t n){for(int i=3;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static MI_CU_UNUSED void mi_cu_p64(unsigned char *p,uint64_t n){for(int i=7;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static MI_CU_UNUSED uint64_t mi_cu_now(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+(uint64_t)t.tv_nsec/1000000;}
static MI_CU_UNUSED int mi_cu_wait(int fd,short events,uint64_t until){
 for(;;){uint64_t now=mi_cu_now();if(!now||now>=until){errno=ETIMEDOUT;return 0;}struct pollfd p={fd,events,0};int n=poll(&p,1,(int)(until-now));if(n<0&&errno==EINTR)continue;if(n!=1||!(p.revents&events)){if(n>=0)errno=EIO;return 0;}return 1;}
}
static MI_CU_UNUSED int mi_cu_read(int fd,void *raw,size_t n){
 unsigned char *p=raw;size_t at=0;uint64_t until=mi_cu_now()+10000;
 while(at<n){if(!mi_cu_wait(fd,POLLIN,until))return 0;ssize_t got=read(fd,p+at,n-at);if(got>0)at+=(size_t)got;else if(got<0&&errno==EINTR)continue;else{if(!got)errno=EPIPE;return 0;}}return 1;
}
static MI_CU_UNUSED int mi_cu_write(int fd,const void *raw,size_t n){
 const unsigned char *p=raw;size_t at=0;uint64_t until=mi_cu_now()+10000;
 while(at<n){if(!mi_cu_wait(fd,POLLOUT,until))return 0;ssize_t got=write(fd,p+at,n-at);if(got>0)at+=(size_t)got;else if(got<0&&errno==EINTR)continue;else{if(!got)errno=EPIPE;return 0;}}return 1;
}
static MI_CU_UNUSED int mi_cu_proc(pid_t pid,struct proc_bsdinfo *p){return pid>0&&proc_pidinfo(pid,PROC_PIDTBSDINFO,0,p,sizeof(*p))==(int)sizeof(*p)&&p->pbi_pid==(uint32_t)pid;}
static MI_CU_UNUSED int mi_cu_parent(uint32_t kind,struct proc_bsdinfo *parent){
 char path[PROC_PIDPATHINFO_MAXSIZE];struct stat identity;pid_t pid=getppid();
 if(!mi_cu_proc(pid,parent)||proc_pidpath(pid,path,sizeof(path))<=0)return 0;
 const char *name=strrchr(path,'/');if(!name||strcmp(name+1,MI_CUSTODY_PARENT_NAME))return 0;
 if(lstat(path,&identity)||!S_ISREG(identity.st_mode)||identity.st_nlink!=1||(identity.st_mode&0022))return 0;
 uid_t owner=kind==2?geteuid():0;
 return (kind==1||kind==2)&&parent->pbi_uid==owner&&parent->pbi_ruid==owner&&identity.st_uid==owner;
}
static MI_CU_UNUSED int mi_cu_socket(int fd,uid_t parent_uid){
 struct stat st;struct sockaddr_storage address;socklen_t n=sizeof(address);uid_t uid;gid_t gid;
 return !fstat(fd,&st)&&S_ISSOCK(st.st_mode)&&!getsockname(fd,(struct sockaddr*)&address,&n)&&address.ss_family==AF_UNIX&&!getpeereid(fd,&uid,&gid)&&uid==parent_uid;
}
static MI_CU_UNUSED void mi_cu_encode_birth(const mi_custody_birth *b,unsigned char out[112]){
 memset(out,0,112);memcpy(out,"XMCUST01",8);mi_cu_p32(out+8,1);mi_cu_p32(out+12,b->kind);mi_cu_p32(out+16,b->role);mi_cu_p32(out+20,b->uid);mi_cu_p32(out+24,b->parent_uid);mi_cu_p32(out+28,b->parent_pid);mi_cu_p32(out+32,b->child_pid);mi_cu_p64(out+40,b->parent_sec);mi_cu_p64(out+48,b->parent_usec);mi_cu_p64(out+56,b->child_sec);mi_cu_p64(out+64,b->child_usec);memcpy(out+72,b->nonce,32);
}
static MI_CU_UNUSED int mi_cu_read_birth(int fd,uint32_t role,uint32_t kind,mi_custody_birth *b){
 struct proc_bsdinfo parent,self;unsigned char bytes[112],nonzero=0;
 /* Reject an unrelated caller before reading or closing any inherited FD. */
 if(!mi_cu_parent(kind,&parent)||!mi_cu_socket(fd,parent.pbi_uid)||!mi_cu_proc(getpid(),&self))return 0;
 if(!mi_cu_read(fd,bytes,sizeof(bytes))||memcmp(bytes,"XMCUST01",8)||mi_cu_u32(bytes+8)!=1||mi_cu_u32(bytes+12)!=kind||mi_cu_u32(bytes+16)!=role||mi_cu_u32(bytes+24)!=parent.pbi_uid||mi_cu_u32(bytes+28)!=parent.pbi_pid||mi_cu_u32(bytes+32)!=(uint32_t)getpid()||mi_cu_u32(bytes+36)||mi_cu_u64(bytes+104))return 0;
 if(mi_cu_u64(bytes+40)!=parent.pbi_start_tvsec||mi_cu_u64(bytes+48)!=parent.pbi_start_tvusec||mi_cu_u64(bytes+56)!=self.pbi_start_tvsec||mi_cu_u64(bytes+64)!=self.pbi_start_tvusec||self.pbi_ppid!=parent.pbi_pid)return 0;
 if(role==1&&(mi_cu_u32(bytes+20)!=self.pbi_uid||self.pbi_uid!=self.pbi_ruid))return 0;
 for(int i=0;i<32;i++)nonzero|=bytes[72+i];if(!nonzero)return 0;
 memset(b,0,sizeof(*b));b->kind=kind;b->role=role;b->uid=mi_cu_u32(bytes+20);b->parent_uid=parent.pbi_uid;b->parent_pid=parent.pbi_pid;b->child_pid=self.pbi_pid;b->parent_sec=parent.pbi_start_tvsec;b->parent_usec=parent.pbi_start_tvusec;b->child_sec=self.pbi_start_tvsec;b->child_usec=self.pbi_start_tvusec;memcpy(b->nonce,bytes+72,32);return 1;
}
static MI_CU_UNUSED void mi_cu_fact(unsigned char *p,const struct stat *s){mi_cu_p64(p,(uint64_t)s->st_dev);mi_cu_p64(p+8,(uint64_t)s->st_ino);mi_cu_p32(p+16,s->st_uid);mi_cu_p32(p+20,s->st_mode);mi_cu_p64(p+24,s->st_nlink);}
static MI_CU_UNUSED int mi_cu_same_fact(const unsigned char *p,const struct stat *s){unsigned char actual[32];mi_cu_fact(actual,s);return !memcmp(actual,p,32);}
static MI_CU_UNUSED int mi_cu_send_fds(int socket_fd,const mi_custody_birth *birth,const int fds[3],const unsigned char ledger[32],const unsigned char pool[32]){
 unsigned char data[MI_CUSTODY_TRANSFER_BYTES]={0};struct stat facts[3];memcpy(data,"XMFDSET1",8);memcpy(data+8,birth->nonce,32);memcpy(data+40,ledger,32);memcpy(data+72,pool,32);
 for(int i=0;i<3;i++){if(fstat(fds[i],facts+i))return 0;mi_cu_fact(data+104+i*32,facts+i);}
 union {struct cmsghdr align;unsigned char bytes[CMSG_SPACE(3*sizeof(int))];} control;
 memset(&control,0,sizeof(control));struct iovec io={data,sizeof(data)};struct msghdr msg;memset(&msg,0,sizeof(msg));msg.msg_iov=&io;msg.msg_iovlen=1;msg.msg_control=control.bytes;msg.msg_controllen=sizeof(control.bytes);
 struct cmsghdr *c=CMSG_FIRSTHDR(&msg);c->cmsg_level=SOL_SOCKET;c->cmsg_type=SCM_RIGHTS;c->cmsg_len=CMSG_LEN(3*sizeof(int));memcpy(CMSG_DATA(c),fds,3*sizeof(int));
 ssize_t n;do{n=sendmsg(socket_fd,&msg,0);}while(n<0&&errno==EINTR);if(n!=(ssize_t)sizeof(data)){if(n>=0)errno=EIO;return 0;}return 1;
}
static MI_CU_UNUSED int mi_cu_fail(mi_custody_received *r,int error){if(!r->first_error_present){r->first_error_present=1;r->first_errno=error;}r->unknown=1;return 0;}
static MI_CU_UNUSED int mi_cu_close(mi_custody_received *r){int good=1;
 for(int i=0;i<16;i++)if(r->fds[i]>=0){int failed=0;for(int k=0;k<r->failed_count;k++)if(r->failed_fds[k]==r->fds[i])failed=1;if(failed){good=0;continue;}int result=close(r->fds[i]);
#ifdef MI_CUSTODY_COMPONENT_CLOSE_ZERO
#ifndef MI_CUSTODY_TRANSPORT_COMPONENT
#error close_fault_is_only_the_explicit_transport_component
#endif
 if(i==0){result=-1;errno=0;}
#endif
 if(result){int at=r->failed_count++;r->failed_fds[at]=r->fds[i];r->failed_codes[at]=errno;mi_cu_fail(r,errno);good=0;}else r->fds[i]=-1;}
 if(good)r->closed=1;return good&&!r->unknown;
}
static MI_CU_UNUSED int mi_cu_close_one(mi_custody_received *r,int index){
 int fd=r->fds[index];if(fd<0)return 1;
 for(int i=0;i<r->failed_count;i++)if(r->failed_fds[i]==fd)return 0;
 if(close(fd)){int at=r->failed_count++;r->failed_fds[at]=fd;r->failed_codes[at]=errno;return mi_cu_fail(r,errno);}r->fds[index]=-1;return 1;
}
static MI_CU_UNUSED int mi_cu_fixed_directory(const mi_custody_birth *b,mi_custody_received *r){
 if(r->unknown||r->closed)return 0;char path[PATH_MAX];
#ifdef MI_CUSTODY_COMPONENT_SOURCE_ROOT
 if(snprintf(path,sizeof(path),"%s",MI_CUSTODY_COMPONENT_SOURCE_ROOT)>=(int)sizeof(path))return mi_cu_fail(r,EINVAL);
#elif defined(NR_FIXTURE_ROOT)
 if(snprintf(path,sizeof(path),"%s",NR_FIXTURE_ROOT)>=(int)sizeof(path))return mi_cu_fail(r,EINVAL);
#else
 long n=sysconf(_SC_GETPW_R_SIZE_MAX);if(n<1024)n=16384;if(n>1048576)return mi_cu_fail(r,EINVAL);
 char *buffer=malloc((size_t)n);struct passwd pwd,*actual=NULL;if(!buffer)return mi_cu_fail(r,ENOMEM);
 int found=getpwuid_r(b->uid,&pwd,buffer,(size_t)n,&actual);int lookup_good=!found&&actual&&pwd.pw_dir&&snprintf(path,sizeof(path),"%s/Library/Application Support/xiaok/runtime",pwd.pw_dir)<(int)sizeof(path);free(buffer);if(!lookup_good)return mi_cu_fail(r,EINVAL);
#endif
 (void)b;
 if(path[0]!='/')return mi_cu_fail(r,EINVAL);
 r->fds[3]=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(r->fds[3]<0)return mi_cu_fail(r,errno);
 char *save=NULL;for(char *part=strtok_r(path,"/",&save);part;part=strtok_r(NULL,"/",&save)){
  if(!strcmp(part,".")||!strcmp(part,".."))return mi_cu_fail(r,EINVAL);
  r->fds[4]=openat(r->fds[3],part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(r->fds[4]<0)return mi_cu_fail(r,errno);
  if(!mi_cu_close_one(r,3))return 0;r->fds[3]=r->fds[4];r->fds[4]=-1;
 }
 struct stat current;int good=!fstat(r->fds[3],&current)&&S_ISDIR(current.st_mode)&&current.st_dev==r->facts[0].st_dev&&current.st_ino==r->facts[0].st_ino&&current.st_uid==r->facts[0].st_uid&&current.st_mode==r->facts[0].st_mode;
 if(!good)mi_cu_fail(r,EINVAL);if(!mi_cu_close_one(r,3))good=0;return good&&!r->unknown;
}
static MI_CU_UNUSED int mi_cu_receive_fds(int fd,const mi_custody_birth *birth,mi_custody_received *r){
 if(r->entered)return mi_cu_fail(r,EINVAL);r->entered=1;
 unsigned char bytes[MI_CUSTODY_TRANSFER_BYTES];union {struct cmsghdr align;unsigned char bytes[CMSG_SPACE(16*sizeof(int))];} control;memset(&control,0,sizeof(control));struct iovec io={bytes,sizeof(bytes)};struct msghdr msg;memset(&msg,0,sizeof(msg));msg.msg_iov=&io;msg.msg_iovlen=1;msg.msg_control=control.bytes;msg.msg_controllen=sizeof(control.bytes);
 if(!mi_cu_wait(fd,POLLIN,mi_cu_now()+10000))return mi_cu_fail(r,errno);
 ssize_t n;do{n=recvmsg(fd,&msg,0);}while(n<0&&errno==EINTR);int count=0,bad=0;
 if(n<0)return mi_cu_fail(r,errno);
 for(struct cmsghdr *c=CMSG_FIRSTHDR(&msg);c;c=CMSG_NXTHDR(&msg,c)){
  if(c->cmsg_level!=SOL_SOCKET||c->cmsg_type!=SCM_RIGHTS||c->cmsg_len<CMSG_LEN(0)){bad=1;continue;}
  size_t remaining=msg.msg_controllen-(size_t)((unsigned char*)c-control.bytes);if(c->cmsg_len>remaining){bad=1;break;}
  size_t size=c->cmsg_len-CMSG_LEN(0);if(size%sizeof(int))bad=1;
  for(size_t i=0;i<size/sizeof(int);i++){int owned;memcpy(&owned,(unsigned char*)CMSG_DATA(c)+i*sizeof(int),sizeof(int));if(count<16)r->fds[count]=owned;else{bad=1;if(close(owned))mi_cu_fail(r,errno);}count++;}
 }
 if(n!=(ssize_t)sizeof(bytes)||count!=3||bad||(msg.msg_flags&(MSG_TRUNC|MSG_CTRUNC))||memcmp(bytes,"XMFDSET1",8)||memcmp(bytes+8,birth->nonce,32))return mi_cu_fail(r,EINVAL);
 for(int i=0;i<3;i++)if(fcntl(r->fds[i],F_SETFD,FD_CLOEXEC)||fstat(r->fds[i],r->facts+i))return mi_cu_fail(r,errno);
 for(int i=0;i<3;i++)if(!mi_cu_same_fact(bytes+104+i*32,r->facts+i))return mi_cu_fail(r,EINVAL);
 if(!S_ISDIR(r->facts[0].st_mode)||r->facts[0].st_uid!=birth->uid)return mi_cu_fail(r,EINVAL);
 for(int i=1;i<3;i++)if(!S_ISREG(r->facts[i].st_mode)||r->facts[i].st_uid!=birth->uid||r->facts[i].st_nlink!=1)return mi_cu_fail(r,EINVAL);
 struct stat named;if(fstatat(r->fds[0],"issuer.lock",&named,AT_SYMLINK_NOFOLLOW)||named.st_dev!=r->facts[1].st_dev||named.st_ino!=r->facts[1].st_ino||fstatat(r->fds[0],"root-resource-v1.sqlite",&named,AT_SYMLINK_NOFOLLOW)||named.st_dev!=r->facts[2].st_dev||named.st_ino!=r->facts[2].st_ino)return mi_cu_fail(r,EINVAL);
 const char *sidecars[]={"root-resource-v1.sqlite-journal","root-resource-v1.sqlite-wal","root-resource-v1.sqlite-shm"};for(int i=0;i<3;i++)if(!fstatat(r->fds[0],sidecars[i],&named,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT)return mi_cu_fail(r,EINVAL);
 memcpy(r->ledger_digest,bytes+40,32);memcpy(r->pool_id,bytes+72,32);unsigned char ledger_bits=0,pool_bits=0;for(int i=0;i<32;i++){ledger_bits|=r->ledger_digest[i];pool_bits|=r->pool_id[i];}if(!ledger_bits||!pool_bits)return mi_cu_fail(r,EINVAL);return mi_cu_fixed_directory(birth,r);
}
#endif
#endif
