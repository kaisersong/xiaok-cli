#define _DARWIN_C_SOURCE
#include "wire.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <time.h>
#include <libproc.h>
#include <sys/proc_info.h>
static mi_birth birth;
static int fd[3]={-1,-1,-1};
static unsigned char key[3][32],release[3][32];
static uint64_t sequence[3]={0,1,1};
static int request_body(int domain,int op,int slot,uint64_t offset,const unsigned char *bytes,uint32_t length,uint32_t amount,unsigned char *out,mi_frame *answer){
 mi_frame f={0};f.domain=(uint8_t)domain;f.operation=(uint16_t)op;f.slot=(uint16_t)slot;f.sequence=sequence[domain]++;f.offset=offset;f.amount=amount;f.payload_length=length;memcpy(f.nonce,birth.nonce,32);
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;return mi_wire_send(fd[domain],key[domain],&f,bytes,deadline)&&mi_wire_receive(fd[domain],key[domain],answer,out,out?MI_MAX_PAYLOAD:0,deadline)&&answer->domain==domain&&answer->operation==(op|MI_RESPONSE)&&answer->sequence==f.sequence&&!answer->status&&!memcmp(answer->nonce,birth.nonce,32);
}
static int request(int domain,int op,int slot,uint64_t offset,const unsigned char *bytes,uint32_t amount,unsigned char *out,mi_frame *answer){return request_body(domain,op,slot,offset,bytes,op==MI_WRITE?amount:0,amount,out,answer);}
static int database_fd_present(void){
 struct stat db;if(stat(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME,&db))return 1;struct rlimit lim;if(getrlimit(RLIMIT_NOFILE,&lim)||lim.rlim_cur>1048576)return 1;
 for(int n=0;n<(int)lim.rlim_cur;n++){struct stat s;if(!fstat(n,&s)&&s.st_dev==db.st_dev&&s.st_ino==db.st_ino)return 1;}return 0;
}
static int remote_file_descriptors(void){
 struct stat receipt,db,lock;if(stat(MI_FIXED_ROOT "/authority/birth.receipts",&receipt)||stat(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME,&db)||stat(MI_FIXED_ROOT "/authority/issuer.lock",&lock))return -1;
 struct proc_fdinfo fds[1024];int n=proc_pidinfo((int)birth.helper_pid,PROC_PIDLISTFDS,0,fds,sizeof(fds));if(n<=0||n==(int)sizeof(fds))return -1;int count=0;
 for(int i=0;i<n/(int)sizeof(fds[0]);i++){if(fds[i].proc_fdtype!=PROX_FDTYPE_VNODE)continue;struct vnode_fdinfowithpath info;if(proc_pidfdinfo((int)birth.helper_pid,fds[i].proc_fd,PROC_PIDFDVNODEPATHINFO,&info,sizeof(info))!=(int)sizeof(info))return -1;struct vinfo_stat *v=&info.pvip.vip_vi.vi_stat;if((v->vst_dev==(uint32_t)db.st_dev&&v->vst_ino==(uint64_t)db.st_ino)||(v->vst_dev==(uint32_t)lock.st_dev&&v->vst_ino==(uint64_t)lock.st_ino)||(v->vst_dev==(uint32_t)receipt.st_dev&&v->vst_ino==(uint64_t)receipt.st_ino))count++;}return count;
}
static int remote_family_descriptors(void){
 struct proc_fdinfo fds[1024];int n=proc_pidinfo((int)birth.helper_pid,PROC_PIDLISTFDS,0,fds,sizeof(fds));if(n<=0||n==(int)sizeof(fds))return -1;int count=0;
 for(int i=0;i<n/(int)sizeof(fds[0]);i++){if(fds[i].proc_fdtype!=PROX_FDTYPE_VNODE)continue;struct vnode_fdinfowithpath info;if(proc_pidfdinfo((int)birth.helper_pid,fds[i].proc_fd,PROC_PIDFDVNODEPATHINFO,&info,sizeof(info))!=(int)sizeof(info))return -1;if(!strncmp(info.pvip.vip_path,MI_FIXED_ROOT "/authority-families/",sizeof(MI_FIXED_ROOT "/authority-families/")-1))count++;}return count;
}
static int positive(void){
 const unsigned char text[]="stage1-original-known";unsigned char out[MI_MAX_PAYLOAD];mi_frame answer;
 return request(MI_ROOT_IO,MI_WRITE,MI_DATABASE,0,text,sizeof(text)-1,NULL,&answer)&&answer.amount==sizeof(text)-1&&request(MI_ROOT_IO,MI_SYNC,MI_DATABASE,0,NULL,0,NULL,&answer)&&request(MI_ROOT_IO,MI_READ,MI_DATABASE,0,NULL,sizeof(text)-1,out,&answer)&&answer.payload_length==sizeof(text)-1&&!memcmp(out,text,sizeof(text)-1);
}
static void finish(void){for(int domain=1;domain<=2;domain++)if(fd[domain]>=0){mi_frame a;request(domain,MI_CLOSE,MI_SLOT_NONE,0,NULL,0,NULL,&a);close(fd[domain]);fd[domain]=-1;}mi_zero(key,sizeof(key));mi_zero(&birth,sizeof(birth));}
static int compare_file(const unsigned char *old,size_t length){
 int f=open(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME,O_RDONLY|O_CLOEXEC);if(f<0)return 0;unsigned char current[128];ssize_t n=read(f,current,sizeof(current));int good=n>=0&&(size_t)n==length&&!memcmp(old,current,length);if(close(f))good=0;return good;
}
static int hex_equal(const unsigned char *p,const char *h){for(int i=0;i<32;i++){char b[3];snprintf(b,3,"%02x",p[i]);if(b[0]!=h[2*i]||b[1]!=h[2*i+1])return 0;}return 1;}
static int vectors(void){
 mi_birth b={100,200,501,{0},{0}};unsigned char c[32],s[32],r[32],pre[32],final[32];for(int i=0;i<32;i++){b.nonce[i]=(unsigned char)i;b.seed[i]=(unsigned char)(32+i);c[i]=(unsigned char)(64+i);s[i]=(unsigned char)(96+i);r[i]=(unsigned char)(128+i);}
 if(!mi_derive_key(&b,MI_ROOT_IO,pre)||!hex_equal(pre,"1a8a57b3e85e7d6556d5f5e642d35605da6aaeda6f0b2fea85845694dfb7cfcb")||!mi_finalize_key(&b,MI_ROOT_IO,c,s,r,final)||!hex_equal(final,"5000781442801a71b3abd20759407a150b7f7e554471b0d31bb701b6c67bf414"))return 0;
 mi_frame f={0},d;f.domain=MI_ROOT_IO;f.operation=MI_WRITE;f.slot=MI_DATABASE;f.sequence=1;f.offset=7;f.payload_length=f.amount=3;memcpy(f.nonce,b.nonce,32);unsigned char encoded[107],out[4],small[104];size_t n;
 if(!mi_frame_encode(final,&f,(const unsigned char*)"abc",encoded,sizeof(encoded),&n)||!mi_frame_decode(final,encoded,n,&d,out,sizeof(out))||memcmp(out,"abc",3))return 0;
 if(!hex_equal(encoded+72,"e3f41a6b2f12c0853bae4760bb85b3d31aef9405427fe7e3d551642c16408f84"))return 0;
 memset(small,0xa5,sizeof(small));if(mi_frame_encode(final,&f,(const unsigned char*)"abc",small,sizeof(small),&n))return 0;for(size_t i=0;i<sizeof(small);i++)if(small[i]!=0xa5)return 0;
 memset(out,0xa5,sizeof(out));if(mi_frame_decode(final,encoded,sizeof(encoded),&d,out,2))return 0;for(size_t i=0;i<sizeof(out);i++)if(out[i]!=0xa5)return 0;
 for(size_t i=0;i<sizeof(encoded);i++){encoded[i]^=1;int accepted=mi_frame_decode(final,encoded,sizeof(encoded),&d,out,sizeof(out));encoded[i]^=1;if(accepted)return 0;}return 1;
}
static uint32_t family_u32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static uint64_t family_u64(const unsigned char *p){uint64_t n=0;for(int i=0;i<8;i++)n=n<<8|p[i];return n;}
static void family_p32(unsigned char *p,uint32_t n){for(int i=3;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static void family_p64(unsigned char *p,uint64_t n){for(int i=7;i>=0;i--){p[i]=(unsigned char)n;n>>=8;}}
static int family_open(uint32_t family,unsigned scope,unsigned char token[32],unsigned char identity[424],uint32_t *kind){
 unsigned char body[36]={0},out[MI_MAX_PAYLOAD];mi_frame a;family_p32(body,family);memset(body+4,(int)scope,32);
 if(!request_body(MI_ROOT_IO,MI_AUTHORITY_OPEN,0,0,body,36,0,out,&a)||a.slot||a.offset||a.amount||a.payload_length<24||a.payload_length!=24+family_u32(out+20))return 0;
 *kind=family_u32(out);if(*kind)return a.payload_length==24;
 if(a.payload_length!=480||family_u32(out+4)||family_u64(out+8)||family_u32(out+16))return 0;memcpy(token,out+24,32);memcpy(identity,out+56,424);return 1;
}
static int family_op(const unsigned char token[32],uint16_t operation,uint16_t slot,uint64_t offset,const unsigned char *body,uint32_t length,uint32_t amount,unsigned char *data,mi_frame *inner,uint32_t *kind){
 unsigned char request_bytes[MI_MAX_PAYLOAD],out[MI_MAX_PAYLOAD];if(length>MI_AUTHORITY_MAX_INNER)return 0;
 memcpy(request_bytes,token,32);request_bytes[32]=(unsigned char)(operation>>8);request_bytes[33]=(unsigned char)operation;request_bytes[34]=(unsigned char)(slot>>8);request_bytes[35]=(unsigned char)slot;family_p64(request_bytes+36,offset);family_p32(request_bytes+44,amount);family_p32(request_bytes+48,length);if(length)memcpy(request_bytes+52,body,length);mi_frame a;
 if(!request_body(MI_ROOT_IO,MI_AUTHORITY_REQUEST,0,0,request_bytes,length+52,0,out,&a)||a.slot||a.offset||a.amount||a.payload_length<24||a.payload_length!=24+family_u32(out+20))return 0;
 *kind=family_u32(out);inner->offset=family_u64(out+8);inner->amount=family_u32(out+16);inner->payload_length=family_u32(out+20);if(data&&inner->payload_length)memcpy(data,out+24,inner->payload_length);return *kind<=3;
}
static int family_release(const unsigned char token[32],uint32_t *kind){unsigned char out[MI_MAX_PAYLOAD];mi_frame a;if(!request_body(MI_ROOT_IO,MI_AUTHORITY_RELEASE,0,0,token,32,0,out,&a)||a.payload_length!=24||family_u32(out+20))return 0;*kind=family_u32(out);return *kind<=3;}
static int family_bind(unsigned char token[32],unsigned char identity[424],const unsigned char root_pool[32],int cold){
 uint32_t kind;mi_frame a;unsigned char body[164]={0};
 if(family_u32(identity+4)==1){if(cold||!family_op(token,MI_CLAIM_FRESH,0,0,NULL,0,0,identity,&a,&kind)||kind||a.payload_length!=424)return 0;}
 if(memcmp(identity+72,root_pool,32))return 0;
 body[3]=cold?2:1;memcpy(body+4,identity+8,32);memcpy(body+36,identity+72,128);
 return family_op(token,MI_BIND_BOOTSTRAP,0,0,body,164,0,identity,&a,&kind)&&kind==0&&a.payload_length==424&&family_u32(identity+4)==3;
}
static int family_journal(const unsigned char token[32],int cold,int leave){
 unsigned char out[MI_MAX_PAYLOAD],ticket[40],old_ticket[40],write[64],mode[4]={0,0,0,2};uint32_t kind;mi_frame a;
 int good=family_op(token,cold?MI_JOURNAL_OPEN_EXISTING:MI_JOURNAL_CREATE,MI_JOURNAL,0,cold?mode:NULL,cold?4:0,0,out,&a,&kind)&&kind==0&&a.payload_length==424&&family_u32(out+356)==1;
 if(!good)return 0;memcpy(ticket,out+344,8);memcpy(ticket+8,out+360,32);memcpy(old_ticket,ticket,40);
 if(!cold){memcpy(write,ticket,40);memcpy(write+40,"same-journal",12);if(!family_op(token,MI_WRITE,MI_JOURNAL,0,write,52,12,NULL,&a,&kind)||kind||a.amount!=12||!family_op(token,MI_SYNC,MI_JOURNAL,0,ticket,40,0,NULL,&a,&kind)||kind)return 0;}
 if(!family_op(token,MI_JOURNAL_CLOSE,MI_JOURNAL,0,ticket,40,0,NULL,&a,&kind)||kind)return 0;
 if(leave)return 1;
 mode[3]=1;if(!family_op(token,MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,mode,4,0,out,&a,&kind)||kind||a.payload_length!=424||!memcmp(old_ticket+8,out+360,32))return 0;memcpy(ticket,out+344,8);memcpy(ticket+8,out+360,32);
 if(!family_op(token,MI_READ,MI_JOURNAL,0,ticket,40,12,out,&a,&kind)||kind||a.payload_length!=12||memcmp(out,"same-journal",12))return 0;
 memcpy(write,old_ticket,40);write[40]=0xee;if(!family_op(token,MI_WRITE,MI_JOURNAL,0,write,41,1,NULL,&a,&kind)||kind!=MI_AUTHORITY_KNOWN_DENIED)return 0;
 memcpy(write,ticket,40);write[40]=0xee;if(!family_op(token,MI_WRITE,MI_JOURNAL,0,write,41,1,NULL,&a,&kind)||kind!=MI_AUTHORITY_KNOWN_DENIED)return 0;
 if(!family_op(token,MI_JOURNAL_CLOSE,MI_JOURNAL,0,ticket,40,0,NULL,&a,&kind)||kind)return 0;
 mode[3]=2;if(!family_op(token,MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,mode,4,0,out,&a,&kind)||kind||a.payload_length!=424)return 0;memcpy(ticket,out+344,8);memcpy(ticket+8,out+360,32);
 return family_op(token,MI_JOURNAL_CLOSE,MI_JOURNAL,0,ticket,40,0,NULL,&a,&kind)&&!kind&&family_op(token,MI_JOURNAL_DELETE,MI_JOURNAL,0,ticket,40,0,NULL,&a,&kind)&&!kind;
}
static int family_scenario(const char *mode,unsigned char root_identity[424]){
 unsigned char bind[164]={0},token[32],identity[424],out[MI_MAX_PAYLOAD];uint32_t kind;mi_frame a;
 if(!strcmp(mode,"family-unbound")){int good=family_open(MI_FAMILY_ADMISSION,0x11,token,identity,&kind)&&kind==MI_AUTHORITY_KNOWN_DENIED;puts(good?"{\"kind\":\"main-fixture-result\",\"unboundDenied\":true}":"{\"kind\":\"main-fixture-result\",\"unboundDenied\":false}");return good;}
 bind[3]=family_u32(root_identity+4)==2?1:2;memcpy(bind+4,root_identity+8,32);memcpy(bind+36,root_identity+72,128);
 if(!request_body(MI_ROOT_IO,MI_BIND_BOOTSTRAP,0,0,bind,164,0,out,&a)||a.payload_length!=424||family_u32(out+4)!=3)return 0;memcpy(root_identity,out,424);
 if(!strcmp(mode,"family-denied")){
  int good=1;const uint32_t families[]={MI_FAMILY_ROOT_NMP,99,MI_FAMILY_BUDGET,MI_FAMILY_BROKER};const unsigned scopes[]={0x11,0x11,0,0x33};for(size_t i=0;i<4;i++)if(!family_open(families[i],scopes[i],token,identity,&kind)||kind!=1)good=0;
  printf("{\"kind\":\"main-fixture-result\",\"allDenied\":%s}\n",good?"true":"false");return good;
 }
 if(!strcmp(mode,"family-contracts")||!strcmp(mode,"family-scopes")||!strcmp(mode,"family-unknown-close")||!strcmp(mode,"family-close-fault")){
  unsigned char second[32],second_id[424];int good=family_open(MI_FAMILY_ADMISSION,0x11,token,identity,&kind)&&!kind&&family_bind(token,identity,root_identity+72,0)&&family_open((!strcmp(mode,"family-unknown-close")||!strcmp(mode,"family-close-fault"))?MI_FAMILY_BUDGET:MI_FAMILY_ADMISSION,0x22,second,second_id,&kind)&&!kind&&family_bind(second,second_id,root_identity+72,0);
  if(!good)return 0;
  if(!strcmp(mode,"family-scopes")){
   good=memcmp(identity+8,second_id+8,32)!=0&&family_op(token,MI_WRITE,MI_DATABASE,0,(const unsigned char*)"first",5,5,NULL,&a,&kind)&&!kind&&family_op(second,MI_WRITE,MI_DATABASE,0,(const unsigned char*)"second",6,6,NULL,&a,&kind)&&!kind&&family_op(token,MI_READ,MI_DATABASE,0,NULL,0,5,out,&a,&kind)&&!kind&&a.payload_length==5&&!memcmp(out,"first",5)&&family_op(second,MI_READ,MI_DATABASE,0,NULL,0,6,out,&a,&kind)&&!kind&&a.payload_length==6&&!memcmp(out,"second",6)&&family_release(token,&kind)&&!kind&&family_release(second,&kind)&&!kind;
   printf("{\"kind\":\"main-fixture-result\",\"scopeIsolation\":%s}\n",good?"true":"false");return good;
  }
  if(!strcmp(mode,"family-unknown-close")||!strcmp(mode,"family-close-fault")){
   const char *path=MI_FIXED_ROOT "/authority-families/admission/1111111111111111111111111111111111111111111111111111111111111111/groups.sqlite";
   good=!strcmp(mode,"family-close-fault")||(chmod(path,0400)==0&&family_op(token,MI_READ,MI_DATABASE,0,NULL,0,1,out,&a,&kind)&&kind==MI_AUTHORITY_UNKNOWN_HELD);
   if(chmod(path,0600))good=0;
   good=good&&(!strcmp(mode,"family-close-fault")||(family_op(token,MI_READ,MI_DATABASE,0,NULL,0,1,out,&a,&kind)&&kind==MI_AUTHORITY_UNKNOWN_HELD))&&family_op(second,MI_WRITE,MI_DATABASE,0,(const unsigned char*)"alive",5,5,NULL,&a,&kind)&&!kind&&family_release(token,&kind)&&kind==MI_AUTHORITY_UNKNOWN_HELD&&family_release(second,&kind)&&!kind;
   mi_frame closed;int ack=request(MI_ROOT_IO,MI_CLOSE,0,0,NULL,0,NULL,&closed);if(close(fd[1]))good=0;fd[1]=-1;
   int files=remote_file_descriptors(),family_files=remote_family_descriptors();good=good&&!ack&&closed.status!=0&&files==0&&family_files==0;
   printf("{\"kind\":\"main-fixture-result\",\"unknownSticky\":%s,\"otherFamilyStillWritable\":%s,\"globalCloseRejected\":%s,\"rootFilesAfter\":%d,\"familyFilesAfter\":%d}\n",good?"true":"false",good?"true":"false",!ack?"true":"false",files,family_files);return good;
  }
  unsigned char foreign[32];memset(foreign,0x44,32);
  good=family_op(foreign,MI_READ,MI_DATABASE,0,NULL,0,1,out,&a,&kind)&&kind==MI_AUTHORITY_KNOWN_DENIED&&family_op(token,MI_AUTHORITY_RELEASE,0,0,NULL,0,0,NULL,&a,&kind)&&kind==MI_AUTHORITY_KNOWN_DENIED&&family_op(token,MI_READ,MI_ISSUER_LOCK,0,NULL,0,1,out,&a,&kind)&&kind==MI_AUTHORITY_KNOWN_DENIED&&family_op(token,MI_READ,MI_DATABASE,0,NULL,0,MI_AUTHORITY_MAX_READ+1,out,&a,&kind)&&kind==MI_AUTHORITY_KNOWN_DENIED;
  unsigned char large[MI_MAX_PAYLOAD];for(size_t i=0;i<sizeof(large);i++)large[i]=(unsigned char)(i*17u);
  if(good)good=family_op(token,MI_WRITE,MI_DATABASE,0,large,MI_AUTHORITY_MAX_INNER,MI_AUTHORITY_MAX_INNER,NULL,&a,&kind)&&!kind&&a.amount==MI_AUTHORITY_MAX_INNER&&family_op(token,MI_READ,MI_DATABASE,0,NULL,0,MI_AUTHORITY_MAX_READ,out,&a,&kind)&&!kind&&a.payload_length==MI_AUTHORITY_MAX_INNER&&!memcmp(large,out,MI_AUTHORITY_MAX_INNER);
  if(good)good=family_release(token,&kind)&&!kind&&family_release(second,&kind)&&!kind;
  printf("{\"kind\":\"main-fixture-result\",\"contractDenials\":%s,\"exactChunkBytes\":%u}\n",good?"true":"false",MI_AUTHORITY_MAX_INNER);return good;
 }
 if(!strcmp(mode,"family-claim-fault")||!strcmp(mode,"family-claim-resume")){
  if(!family_open(MI_FAMILY_ADMISSION,0x11,token,identity,&kind)||kind)return 0;unsigned phase=family_u32(identity+4);int good=family_op(token,MI_CLAIM_FRESH,0,0,NULL,0,0,out,&a,&kind)&&kind==(!strcmp(mode,"family-claim-fault")?MI_AUTHORITY_UNKNOWN_HELD:MI_AUTHORITY_KNOWN_DENIED);
  printf("{\"kind\":\"main-fixture-result\",\"initialPhase\":%u,\"claimAckUnknown\":%s,\"freshReplayDenied\":%s}\n",phase,good&&phase==1?"true":"false",good&&phase==2?"true":"false");return good;
 }
 int cold=!strcmp(mode,"family-cold-read"),leave=!strcmp(mode,"family-cold-create"),good=1,count=0;
 if(!strcmp(mode,"family-wal-reject")){good=family_open(MI_FAMILY_ADMISSION,0x11,token,identity,&kind)&&kind==MI_AUTHORITY_UNKNOWN_HELD;printf("{\"kind\":\"main-fixture-result\",\"oldSidecarRejected\":%s}\n",good?"true":"false");return good;}
 for(uint32_t family=MI_FAMILY_ADMISSION;family<=MI_FAMILY_BROKER;family++){
  if(!family_open(family,0x11,token,identity,&kind)||kind||!family_bind(token,identity,root_identity+72,cold)){good=0;break;}
  unsigned char initial_token[32],repeat[32],repeat_identity[424];memcpy(initial_token,token,32);if(!family_open(family,0x11,repeat,repeat_identity,&kind)||kind||memcmp(token,repeat,32)){good=0;break;}
  char text[32];snprintf(text,sizeof(text),"original-family-%u",family);uint32_t length=(uint32_t)strlen(text);
  if(!cold&&(!family_op(token,MI_WRITE,MI_DATABASE,0,(unsigned char*)text,length,length,NULL,&a,&kind)||kind||a.amount!=length||!family_op(token,MI_SYNC,MI_DATABASE,0,NULL,0,0,NULL,&a,&kind)||kind)){good=0;break;}
  if(!family_op(token,MI_READ,MI_DATABASE,0,NULL,0,length,out,&a,&kind)||kind||a.payload_length!=length||memcmp(out,text,length)||!family_journal(token,cold,leave)){good=0;break;}
  if(!family_release(token,&kind)||kind||!family_release(token,&kind)||kind||!family_open(family,0x11,repeat,repeat_identity,&kind)||kind!=MI_AUTHORITY_KNOWN_DENIED){good=0;break;}
  if(!family_op(initial_token,MI_READ,MI_DATABASE,0,NULL,0,1,out,&a,&kind)||kind!=MI_AUTHORITY_KNOWN_DENIED){good=0;break;}count++;
 }
 printf("{\"kind\":\"main-fixture-result\",\"rootBound\":true,\"familyOpened\":%s,\"families\":%d,\"cold\":%s,\"sameRootPool\":%s}\n",good?"true":"false",count,cold?"true":"false",good?"true":"false");return good;
}

int main(int argc,char **argv){
 setvbuf(stdout,NULL,_IONBF,0);signal(SIGPIPE,SIG_IGN);
 if(argc==2&&!strcmp(argv[1],"--vectors")){int good=vectors();printf("{\"kind\":\"wire-vector-result\",\"passed\":%s}\n",good?"true":"false");return good?0:106;}
 if(argc==4&&!strcmp(argv[1],"--fd-probe")){int one=atoi(argv[2]),two=atoi(argv[3]);int absent=!database_fd_present()&&fcntl(MI_BIRTH_FD,F_GETFD)<0&&fcntl(one,F_GETFD)<0&&fcntl(two,F_GETFD)<0;printf("{\"kind\":\"tool-fd-probe\",\"pid\":%ld,\"privateDescriptorsAbsent\":%s}\n",(long)getpid(),absent?"true":"false");return absent?0:100;}

 unsigned char raw[MI_BIRTH_BYTES];struct stat st;int flags=fcntl(MI_BIRTH_FD,F_GETFL);
 if(flags<0||(flags&O_ACCMODE)!=O_RDONLY||fstat(MI_BIRTH_FD,&st)||!S_ISFIFO(st.st_mode)||!mi_read_exact(MI_BIRTH_FD,raw,sizeof(raw),mi_now_ms()+MI_FRAME_TIMEOUT_MS)||!mi_birth_decode(raw,&birth)||close(MI_BIRTH_FD))return 81;mi_zero(raw,sizeof(raw));
 char mode[64];if(!fgets(mode,sizeof(mode),stdin))return 82;mode[strcspn(mode,"\n")]=0;
 if(!strcmp(mode,"foreign")){puts("{\"ready\":true}");char go[16];if(!fgets(go,sizeof(go),stdin))return 85;}
 if(!mi_connect_fixed_domain(&birth,MI_ROOT_IO,fd+1,key[1],release[1])){fprintf(stderr,"MI_FIXTURE_ROOT_CONNECT_FAILED:%d\n",errno);finish();return 83;}if(!mi_connect_fixed_domain(&birth,MI_DISPATCH,fd+2,key[2],release[2])||memcmp(release[1],release[2],32)){fprintf(stderr,"MI_FIXTURE_DISPATCH_CONNECT_FAILED:%d\n",errno);finish();return 83;}
 unsigned char identity_bytes[MI_MAX_PAYLOAD];mi_frame identity_reply;
 if(!request(MI_ROOT_IO,MI_STORE_IDENTITY,MI_SLOT_NONE,0,NULL,0,identity_bytes,&identity_reply)||identity_reply.payload_length!=424){finish();return 113;}
 if(!strcmp(mode,"v2-claim-fault")||!strcmp(mode,"v2-claim-replay")){
  unsigned char saved[32];memcpy(saved,identity_bytes+72,32);int phase=identity_bytes[7];int rejected=!request(MI_ROOT_IO,MI_CLAIM_FRESH,MI_SLOT_NONE,0,NULL,0,identity_bytes,&identity_reply);char pool[65]={0};for(int i=0;i<32;i++)snprintf(pool+2*i,3,"%02x",saved[i]);printf("{\"kind\":\"main-fixture-result\",\"claimAckRejected\":%s,\"initialPhase\":%d,\"poolId\":\"%s\"}\n",rejected?"true":"false",phase,pool);finish();return rejected?0:121;
 }
 if(!strcmp(mode,"v2-absence")){char pool[65]={0};for(int i=0;i<32;i++)snprintf(pool+2*i,3,"%02x",identity_bytes[72+i]);printf("{\"kind\":\"main-fixture-result\",\"journalAbsent\":%s,\"birthState\":%d,\"poolId\":\"%s\"}\n",identity_bytes[359]?"false":"true",identity_bytes[7],pool);finish();return identity_bytes[359]?122:0;}
 if(strcmp(mode,"v2-no-claim")&&identity_bytes[7]==1&&(!request(MI_ROOT_IO,MI_CLAIM_FRESH,MI_SLOT_NONE,0,NULL,0,identity_bytes,&identity_reply)||identity_reply.payload_length!=424||identity_bytes[7]!=2)){finish();return 114;}
 if(!strcmp(mode,"v2-no-claim")){
  mi_frame answer;int rejected=!request(MI_ROOT_IO,MI_WRITE,MI_DATABASE,0,(const unsigned char*)"UNAUTHORIZED",12,NULL,&answer);struct stat actual;int empty=!stat(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME,&actual)&&actual.st_size==0;printf("{\"kind\":\"main-fixture-result\",\"unclaimedWriteRejected\":%s,\"databaseUnchanged\":%s}\n",rejected?"true":"false",empty?"true":"false");finish();return rejected&&empty?0:115;
 }
 if(!strcmp(mode,"v2-journal")||!strcmp(mode,"v2-journal-leave")||!strcmp(mode,"v2-journal-existing")||!strcmp(mode,"v2-stale-ticket")||!strcmp(mode,"v2-readonly")||!strcmp(mode,"v2-delete-fault")){
  unsigned char body[64]={0},first[40],out[MI_MAX_PAYLOAD];mi_frame a;int existing=!strcmp(mode,"v2-journal-existing");
  body[3]=2;int good=existing?request_body(MI_ROOT_IO,MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,body,4,0,out,&a):request(MI_ROOT_IO,MI_JOURNAL_CREATE,MI_JOURNAL,0,NULL,0,out,&a);
  good=good&&a.payload_length==424&&out[359]==1;if(!good){finish();return 116;}memcpy(body,out+344,8);memcpy(body+8,out+360,32);memcpy(first,body,40);
  if(!existing){memcpy(body+40,"persistent-journal",18);good=request_body(MI_ROOT_IO,MI_WRITE,MI_JOURNAL,0,body,58,18,NULL,&a)&&a.amount==18&&request_body(MI_ROOT_IO,MI_SYNC,MI_JOURNAL,0,body,40,0,NULL,&a);}
  if(!good||!request_body(MI_ROOT_IO,MI_JOURNAL_CLOSE,MI_JOURNAL,0,body,40,0,NULL,&a)){finish();return 117;}
  if(!strcmp(mode,"v2-delete-fault")){int rejected=!request_body(MI_ROOT_IO,MI_JOURNAL_DELETE,MI_JOURNAL,0,body,40,0,NULL,&a);printf("{\"kind\":\"main-fixture-result\",\"deleteAckRejected\":%s}\n",rejected?"true":"false");finish();return rejected?0:123;}
  if(!strcmp(mode,"v2-journal-leave")){puts("{\"kind\":\"main-fixture-result\",\"journalLeftDurable\":true}");finish();return 0;}
  unsigned char mode_body[4]={0,0,0,1};if(!request_body(MI_ROOT_IO,MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,mode_body,4,0,out,&a)||a.payload_length!=424){finish();return 118;}memcpy(body,out+344,8);memcpy(body+8,out+360,32);int fresh=memcmp(first+8,body+8,32)!=0;
  if(!strcmp(mode,"v2-stale-ticket")||!strcmp(mode,"v2-readonly")){
   unsigned char bad[64];memcpy(bad,!strcmp(mode,"v2-stale-ticket")?first:body,40);memcpy(bad+40,"BAD",3);int rejected=!request_body(MI_ROOT_IO,MI_WRITE,MI_JOURNAL,0,bad,43,3,NULL,&a);
   int file=open(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME "-journal",O_RDONLY|O_CLOEXEC);unsigned char check[18];int unchanged=file>=0&&read(file,check,18)==18&&!memcmp(check,"persistent-journal",18);if(file>=0)close(file);printf("{\"kind\":\"main-fixture-result\",\"invalidJournalWriteRejected\":%s,\"journalUnchanged\":%s,\"openTicketChanged\":%s}\n",rejected?"true":"false",unchanged?"true":"false",fresh?"true":"false");finish();return rejected&&unchanged&&fresh?0:119;
  }
  good=request_body(MI_ROOT_IO,MI_READ,MI_JOURNAL,0,body,40,18,out,&a)&&a.payload_length==18&&!memcmp(out,"persistent-journal",18)&&request_body(MI_ROOT_IO,MI_JOURNAL_CLOSE,MI_JOURNAL,0,body,40,0,NULL,&a);
  mode_body[3]=2;if(good)good=request_body(MI_ROOT_IO,MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,mode_body,4,0,out,&a)&&a.payload_length==424;
  if(good){int next=memcmp(body+8,out+360,32)!=0;fresh=fresh&&next;memcpy(body,out+344,8);memcpy(body+8,out+360,32);good=request_body(MI_ROOT_IO,MI_JOURNAL_CLOSE,MI_JOURNAL,0,body,40,0,NULL,&a)&&request_body(MI_ROOT_IO,MI_JOURNAL_DELETE,MI_JOURNAL,0,body,40,0,NULL,&a);}
  struct stat absent;int gone=lstat(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME "-journal",&absent)<0&&errno==ENOENT;printf("{\"kind\":\"main-fixture-result\",\"journalReadMatches\":%s,\"openTicketChanged\":%s,\"journalDeleted\":%s,\"existingAcrossHelper\":%s}\n",good?"true":"false",fresh?"true":"false",gone?"true":"false",existing?"true":"false");finish();return good&&fresh&&gone?0:120;
 }
 if(!strncmp(mode,"family-",7)){int good=family_scenario(mode,identity_bytes);finish();return good?0:130;}
 int exposed=database_fd_present();
 if(!strcmp(mode,"positive")){int good=positive();printf("{\"kind\":\"main-fixture-result\",\"connected\":true,\"readMatches\":%s,\"databaseFdPresent\":%s}\n",good?"true":"false",exposed?"true":"false");finish();return good&&!exposed?0:84;}
 if(!strcmp(mode,"foreign")){int good=positive();printf("{\"kind\":\"main-fixture-result\",\"readMatches\":%s,\"databaseFdPresent\":%s}\n",good?"true":"false",exposed?"true":"false");finish();return good&&!exposed?0:86;}
 if(!strcmp(mode,"replay")){int other=-1;unsigned char k[32],r[32];int accepted=mi_connect_fixed_domain(&birth,MI_ROOT_IO,&other,k,r);if(other>=0)close(other);printf("{\"kind\":\"main-fixture-result\",\"replayRejected\":%s}\n",accepted?"false":"true");finish();return accepted?87:0;}
 if(!strcmp(mode,"fd-inheritance")){
 char one[32],two[32];snprintf(one,sizeof(one),"%d",fd[1]);snprintf(two,sizeof(two),"%d",fd[2]);char *args[]={(char*)MI_MAIN_EXEC,"--fd-probe",one,two,NULL};char *env[]={"PATH=/usr/bin:/bin",NULL};pid_t child=-1;int status=0;int good=posix_spawn(&child,MI_MAIN_EXEC,NULL,NULL,args,env)==0;if(good){while(waitpid(child,&status,0)<0&&errno==EINTR){}good=WIFEXITED(status)&&WEXITSTATUS(status)==0;}printf("{\"kind\":\"main-fixture-result\",\"childPid\":%ld,\"childStatus\":%d,\"childFdsAbsent\":%s}\n",(long)child,status,good?"true":"false");finish();return good?0:101;
 }
 if(!strcmp(mode,"timeout")){
 mi_frame f={0};f.domain=MI_DISPATCH;f.operation=MI_PING;f.sequence=sequence[2]++;memcpy(f.nonce,birth.nonce,32);unsigned char buffer[MI_HEADER_BYTES];size_t n;if(!mi_frame_encode(key[2],&f,NULL,buffer,sizeof(buffer),&n)||!mi_write_exact(fd[2],buffer,MI_HEADER_BYTES/2,mi_now_ms()+1000)){finish();return 102;}struct timespec delay={6,0};while(nanosleep(&delay,&delay)&&errno==EINTR){}mi_frame response;int rejected=!request(MI_ROOT_IO,MI_PING,MI_SLOT_NONE,0,NULL,0,NULL,&response);printf("{\"kind\":\"main-fixture-result\",\"deadlineRejected\":%s}\n",rejected?"true":"false");finish();return rejected?0:103;
 }
 if(!strcmp(mode,"remote-close")){
  int before=remote_file_descriptors();mi_frame answer;int ack=request(MI_ROOT_IO,MI_CLOSE,MI_SLOT_NONE,0,NULL,0,NULL,&answer);if(close(fd[1]))ack=0;fd[1]=-1;int after=remote_file_descriptors();printf("{\"kind\":\"main-fixture-result\",\"rootCloseAck\":%s,\"remoteFilesBefore\":%d,\"remoteFilesAfter\":%d}\n",ack?"true":"false",before,after);finish();return ack&&before==3&&after==0?0:104;
 }
 if(!strcmp(mode,"identity-restore")){
  if(chmod(MI_MAIN_EXEC,0700)){finish();return 110;}int other=-1;unsigned char temporary[32],release_copy[32];int refused=!mi_connect_fixed_domain(&birth,MI_ROOT_IO,&other,temporary,release_copy);if(other>=0)close(other);if(chmod(MI_MAIN_EXEC,0500)){finish();return 111;}mi_frame reply;int still_refused=!request(MI_ROOT_IO,MI_PING,MI_SLOT_NONE,0,NULL,0,NULL,&reply);printf("{\"kind\":\"main-fixture-result\",\"changedIdentityRefused\":%s,\"restoredIdentityStillRefused\":%s}\n",refused?"true":"false",still_refused?"true":"false");finish();return refused&&still_refused?0:112;
 }
 if(!strcmp(mode,"unknown-close")){
  mi_frame packet={0},reply;packet.domain=MI_DISPATCH;packet.operation=MI_PING;packet.sequence=sequence[2];memcpy(packet.nonce,birth.nonce,32);unsigned char encoded[MI_HEADER_BYTES];size_t length;
  if(!mi_frame_encode(key[2],&packet,NULL,encoded,sizeof(encoded),&length)){finish();return 108;}encoded[72]^=1;
  int rejected=mi_write_exact(fd[2],encoded,length,mi_now_ms()+1000)&&!mi_wire_receive(fd[2],key[2],&reply,NULL,0,mi_now_ms()+1000);
  int ack=request(MI_ROOT_IO,MI_CLOSE,MI_SLOT_NONE,0,NULL,0,NULL,&reply);if(close(fd[1]))ack=0;fd[1]=-1;int after=remote_file_descriptors();printf("{\"kind\":\"main-fixture-result\",\"unknownPreserved\":%s,\"negativeCloseAck\":%s,\"remoteFilesAfter\":%d}\n",rejected?"true":"false",ack?"true":"false",after);finish();return rejected&&ack&&after==0?0:109;
 }
 if(!strcmp(mode,"idle")){
  struct timespec delay={6,0};while(nanosleep(&delay,&delay)&&errno==EINTR){}int good=positive();printf("{\"kind\":\"main-fixture-result\",\"idleStillCurrent\":%s}\n",good?"true":"false");finish();return good?0:105;
 }
 if(!strcmp(mode,"chunks")){
  unsigned char *bytes=malloc(MI_MAX_PAYLOAD),*out=malloc(MI_MAX_PAYLOAD);if(!bytes||!out){free(bytes);free(out);finish();return 88;}int good=1;mi_frame a;
  for(uint32_t chunk=0;chunk<3&&good;chunk++){for(uint32_t i=0;i<MI_MAX_PAYLOAD;i++)bytes[i]=(unsigned char)(i+chunk);good=request(MI_ROOT_IO,MI_WRITE,MI_DATABASE,(uint64_t)chunk*MI_MAX_PAYLOAD,bytes,MI_MAX_PAYLOAD,NULL,&a)&&a.amount==MI_MAX_PAYLOAD;}
  for(uint32_t chunk=0;chunk<3&&good;chunk++){for(uint32_t i=0;i<MI_MAX_PAYLOAD;i++)bytes[i]=(unsigned char)(i+chunk);good=request(MI_ROOT_IO,MI_READ,MI_DATABASE,(uint64_t)chunk*MI_MAX_PAYLOAD,NULL,MI_MAX_PAYLOAD,out,&a)&&a.payload_length==MI_MAX_PAYLOAD&&!memcmp(bytes,out,MI_MAX_PAYLOAD);}
  free(bytes);free(out);printf("{\"kind\":\"main-fixture-result\",\"readMatches\":%s,\"chunks\":3}\n",good?"true":"false");finish();return good?0:89;
 }
 if(!strcmp(mode,"split-channels")){
  mi_frame f={0};f.domain=MI_DISPATCH;f.operation=MI_PING;f.sequence=sequence[2]++;memcpy(f.nonce,birth.nonce,32);unsigned char buffer[MI_HEADER_BYTES];size_t n;
  if(!mi_frame_encode(key[2],&f,NULL,buffer,sizeof(buffer),&n)||!mi_write_exact(fd[2],buffer,MI_HEADER_BYTES/2,mi_now_ms()+1000)){finish();return 90;}
  int good=positive();printf("{\"kind\":\"main-fixture-result\",\"readMatches\":%s,\"longDomainPending\":true}\n",good?"true":"false");
  if(!mi_write_exact(fd[2],buffer+MI_HEADER_BYTES/2,MI_HEADER_BYTES/2,mi_now_ms()+1000)){finish();return 91;}mi_frame reply;if(!mi_wire_receive(fd[2],key[2],&reply,NULL,0,mi_now_ms()+1000)){finish();return 92;}finish();return good?0:93;
 }
 if(!strcmp(mode,"wrong-domain")||!strcmp(mode,"bad-sequence")||!strcmp(mode,"bad-mac")){
  unsigned char old[128];int f=open(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME,O_RDONLY|O_CLOEXEC);if(f<0){finish();return 94;}ssize_t old_n=read(f,old,sizeof(old));struct stat previous;if(fstat(f,&previous)||previous.st_size>(off_t)sizeof(old)||old_n<0){close(f);finish();return 95;}close(f);
  int domain=!strcmp(mode,"wrong-domain")?MI_DISPATCH:MI_ROOT_IO;mi_frame packet={0},reply;packet.domain=(uint8_t)domain;packet.operation=MI_WRITE;packet.slot=MI_DATABASE;packet.sequence=!strcmp(mode,"bad-sequence")?sequence[domain]+1:sequence[domain];packet.amount=packet.payload_length=3;memcpy(packet.nonce,birth.nonce,32);unsigned char encoded[MI_MAX_FRAME],result[MI_MAX_PAYLOAD];size_t length;
  if(!mi_frame_encode(key[domain],&packet,(const unsigned char*)"BAD",encoded,sizeof(encoded),&length)){finish();return 96;}if(!strcmp(mode,"bad-mac"))encoded[72]^=1;
  int rejected=!mi_write_exact(fd[domain],encoded,length,mi_now_ms()+1000)||!mi_wire_receive(fd[domain],key[domain],&reply,result,sizeof(result),mi_now_ms()+MI_FRAME_TIMEOUT_MS);
  int unchanged=compare_file(old,(size_t)old_n);printf("{\"kind\":\"main-fixture-result\",\"rejected\":%s,\"bytesUnchanged\":%s}\n",rejected?"true":"false",unchanged?"true":"false");finish();return rejected&&unchanged?0:97;
 }
 finish();return 98;
}
