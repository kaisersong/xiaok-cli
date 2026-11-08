#define _DARWIN_C_SOURCE
#include "wire.h"
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonHMAC.h>
#include <Security/SecRandom.h>
#include <bsm/libbsm.h>
#endif
static void put16(unsigned char *p,uint16_t v){p[0]=(unsigned char)(v>>8);p[1]=(unsigned char)v;}
static void put32(unsigned char *p,uint32_t v){for(int i=3;i>=0;i--){p[i]=(unsigned char)v;v>>=8;}}
static void put64(unsigned char *p,uint64_t v){for(int i=7;i>=0;i--){p[i]=(unsigned char)v;v>>=8;}}
static uint16_t get16(const unsigned char *p){return (uint16_t)((uint16_t)p[0]<<8|p[1]);}
static uint32_t get32(const unsigned char *p){uint32_t v=0;for(int i=0;i<4;i++)v=v<<8|p[i];return v;}
static uint64_t get64(const unsigned char *p){uint64_t v=0;for(int i=0;i<8;i++)v=v<<8|p[i];return v;}
void mi_zero(void *raw,size_t n){volatile unsigned char *p=raw;while(n--)*p++=0;}
uint64_t mi_now_ms(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000u+(uint64_t)t.tv_nsec/1000000u;}
int mi_random(void *p,size_t n){
#ifdef __APPLE__
 return SecRandomCopyBytes(kSecRandomDefault,n,p)==errSecSuccess;
#else
 (void)p;(void)n;return 0;
#endif
}
int mi_birth_encode(const mi_birth *b,unsigned char out[MI_BIRTH_BYTES]){
 if(!b||!b->helper_pid||!b->child_pid||!b->uid)return 0;
 memcpy(out,"XKMBIRTH",8);put32(out+8,MI_PROTOCOL_VERSION);put32(out+12,b->helper_pid);put32(out+16,b->child_pid);put32(out+20,b->uid);memcpy(out+24,b->nonce,32);memcpy(out+56,b->seed,32);return 1;
}
int mi_birth_decode(const unsigned char in[MI_BIRTH_BYTES],mi_birth *b){
 if(memcmp(in,"XKMBIRTH",8)||get32(in+8)!=MI_PROTOCOL_VERSION)return 0;
 b->helper_pid=get32(in+12);b->child_pid=get32(in+16);b->uid=get32(in+20);memcpy(b->nonce,in+24,32);memcpy(b->seed,in+56,32);return b->helper_pid&&b->child_pid&&b->uid;
}
int mi_derive_key(const mi_birth *b,uint8_t domain,unsigned char out[32]){
 if(!b||(domain!=MI_ROOT_IO&&domain!=MI_DISPATCH&&domain!=MI_KSWARM_IO&&domain!=MI_BROKER_IO))return 0;
#ifdef __APPLE__
 unsigned char prk[32],info[64];const char *label="xiaok-main-installation-v1";size_t n=strlen(label);
 CCHmac(kCCHmacAlgSHA256,b->nonce,32,b->seed,32,prk);memcpy(info,label,n);info[n++]=(unsigned char)MI_BUILD_KIND;info[n++]=domain;
 put32(info+n,b->helper_pid);n+=4;put32(info+n,b->child_pid);n+=4;put32(info+n,b->uid);n+=4;info[n++]=1;
 CCHmac(kCCHmacAlgSHA256,prk,32,info,n,out);mi_zero(prk,sizeof(prk));mi_zero(info,sizeof(info));return 1;
#else
 (void)out;return 0;
#endif
}
int mi_finalize_key(const mi_birth *b,uint8_t domain,const unsigned char client_nonce[32],const unsigned char server_nonce[32],const unsigned char release[32],unsigned char out[32]){
#ifdef __APPLE__
 unsigned char prekey[32],salt[64],prk[32],info[160];if(!mi_derive_key(b,domain,prekey))return 0;
 memcpy(salt,client_nonce,32);memcpy(salt+32,server_nonce,32);CCHmac(kCCHmacAlgSHA256,salt,64,prekey,32,prk);
 const char *label="xiaok-main-installation-final-v1";size_t n=strlen(label);memcpy(info,label,n);info[n++]=(unsigned char)MI_BUILD_KIND;info[n++]=domain;
 put32(info+n,b->helper_pid);n+=4;put32(info+n,b->child_pid);n+=4;put32(info+n,b->uid);n+=4;memcpy(info+n,b->nonce,32);n+=32;memcpy(info+n,release,32);n+=32;info[n++]=1;
 CCHmac(kCCHmacAlgSHA256,prk,32,info,n,out);mi_zero(prekey,32);mi_zero(salt,64);mi_zero(prk,32);mi_zero(info,sizeof(info));return 1;
#else
 (void)b;(void)domain;(void)client_nonce;(void)server_nonce;(void)release;(void)out;return 0;
#endif
}
static int operation(uint16_t op){op&=(uint16_t)~MI_RESPONSE;return (op>=MI_HELLO&&op<=MI_KSWARM_RETIRE)||(op>=MI_BROKER_PREPARE&&op<=MI_BROKER_RETIRE)||op==MI_CLAIM_ADOPTED;}
static int fixed_header(const unsigned char *p){return !memcmp(p,"XMIO",4)&&get16(p+4)==MI_PROTOCOL_VERSION&&p[6]==MI_BUILD_KIND&&(p[7]==MI_ROOT_IO||p[7]==MI_DISPATCH||p[7]==MI_KSWARM_IO||p[7]==MI_BROKER_IO)&&operation(get16(p+8))&&get16(p+10)<=MI_ISSUER_LOCK&&get32(p+32)<=MI_MAX_PAYLOAD&&get32(p+36)<=MI_MAX_PAYLOAD;}
static int mac(const unsigned char key[32],const unsigned char *p,size_t n,unsigned char out[32]){
#ifdef __APPLE__
 CCHmacContext c;CCHmacInit(&c,kCCHmacAlgSHA256,key,32);CCHmacUpdate(&c,p,72);if(n>MI_HEADER_BYTES)CCHmacUpdate(&c,p+MI_HEADER_BYTES,n-MI_HEADER_BYTES);CCHmacFinal(&c,out);mi_zero(&c,sizeof(c));return 1;
#else
 (void)key;(void)p;(void)n;(void)out;return 0;
#endif
}
int mi_frame_encode(const unsigned char key[32],const mi_frame *f,const unsigned char *payload,unsigned char *out,size_t capacity,size_t *n){
 if(!f||capacity<MI_HEADER_BYTES+f->payload_length||f->payload_length>MI_MAX_PAYLOAD||f->amount>MI_MAX_PAYLOAD||!operation(f->operation)||f->slot>MI_ISSUER_LOCK||(f->domain!=MI_ROOT_IO&&f->domain!=MI_DISPATCH&&f->domain!=MI_KSWARM_IO&&f->domain!=MI_BROKER_IO)||(f->payload_length&&!payload))return 0;
 memset(out,0,MI_HEADER_BYTES);memcpy(out,"XMIO",4);put16(out+4,MI_PROTOCOL_VERSION);out[6]=MI_BUILD_KIND;out[7]=f->domain;put16(out+8,f->operation);put16(out+10,f->slot);put32(out+12,f->status);put64(out+16,f->sequence);put64(out+24,f->offset);put32(out+32,f->payload_length);put32(out+36,f->amount);memcpy(out+40,f->nonce,32);
 if(f->payload_length)memcpy(out+MI_HEADER_BYTES,payload,f->payload_length);*n=MI_HEADER_BYTES+f->payload_length;return mac(key,out,*n,out+72);
}
int mi_frame_peek_size(const unsigned char *p,size_t n,size_t *out){if(n<MI_HEADER_BYTES||!fixed_header(p))return 0;*out=MI_HEADER_BYTES+get32(p+32);return 1;}
int mi_frame_decode(const unsigned char key[32],const unsigned char *p,size_t n,mi_frame *f,unsigned char *payload,size_t capacity){
 size_t expected;unsigned char digest[32];if(!mi_frame_peek_size(p,n,&expected)||expected!=n||get32(p+32)>capacity||!mac(key,p,n,digest))return 0;
 unsigned diff=0;for(size_t i=0;i<32;i++)diff|=digest[i]^p[72+i];mi_zero(digest,sizeof(digest));if(diff)return 0;
 f->domain=p[7];f->operation=get16(p+8);f->slot=get16(p+10);f->status=get32(p+12);f->sequence=get64(p+16);f->offset=get64(p+24);f->payload_length=get32(p+32);f->amount=get32(p+36);memcpy(f->nonce,p+40,32);
 if(f->payload_length){if(!payload)return 0;memcpy(payload,p+MI_HEADER_BYTES,f->payload_length);}return 1;
}
static int wait_fd(int fd,short events,uint64_t deadline){
 for(;;){uint64_t now=mi_now_ms();if(!now||now>=deadline){errno=ETIMEDOUT;return 0;}uint64_t remaining=deadline-now;struct pollfd p={fd,events,0};int rc=poll(&p,1,remaining>INT_MAX?INT_MAX:(int)remaining);if(rc>0){if(p.revents&events)return 1;errno=EPIPE;return 0;}if(rc<0&&errno==EINTR)continue;if(rc==0)errno=ETIMEDOUT;return 0;}
}
int mi_read_exact(int fd,void *raw,size_t n,uint64_t deadline){unsigned char *p=raw;while(n){if(!wait_fd(fd,POLLIN,deadline))return 0;ssize_t r=read(fd,p,n);if(r>0){p+=r;n-=(size_t)r;}else if(r<0&&(errno==EINTR||errno==EAGAIN))continue;else{if(!r)errno=EPIPE;return 0;}}return 1;}
int mi_write_exact(int fd,const void *raw,size_t n,uint64_t deadline){const unsigned char *p=raw;while(n){if(!wait_fd(fd,POLLOUT,deadline))return 0;ssize_t r=write(fd,p,n);if(r>0){p+=r;n-=(size_t)r;}else if(r<0&&(errno==EINTR||errno==EAGAIN))continue;else{if(!r)errno=EPIPE;return 0;}}return 1;}
int mi_wire_send(int fd,const unsigned char key[32],const mi_frame *f,const unsigned char *p,uint64_t d){unsigned char bytes[MI_MAX_FRAME];size_t n;int good=mi_frame_encode(key,f,p,bytes,sizeof(bytes),&n)&&mi_write_exact(fd,bytes,n,d);mi_zero(bytes,sizeof(bytes));return good;}
int mi_wire_receive(int fd,const unsigned char key[32],mi_frame *f,unsigned char *p,size_t capacity,uint64_t d){unsigned char bytes[MI_MAX_FRAME];size_t n;int good=mi_read_exact(fd,bytes,MI_HEADER_BYTES,d)&&mi_frame_peek_size(bytes,MI_HEADER_BYTES,&n)&&mi_read_exact(fd,bytes+MI_HEADER_BYTES,n-MI_HEADER_BYTES,d)&&mi_frame_decode(key,bytes,n,f,p,capacity);mi_zero(bytes,sizeof(bytes));return good;}
int mi_peer_identity(int fd,uint32_t *pid,uint32_t *uid){
#ifdef __APPLE__
 audit_token_t token;socklen_t n=sizeof(token);uid_t u;gid_t g;
 if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERTOKEN,&token,&n)||n!=sizeof(token)||getpeereid(fd,&u,&g)||u!=audit_token_to_euid(token)||g!=audit_token_to_egid(token))return 0;
 *pid=(uint32_t)audit_token_to_pid(token);*uid=(uint32_t)u;return *pid>0;
#else
 (void)fd;(void)pid;(void)uid;return 0;
#endif
}
int mi_connect_fixed_domain(const mi_birth *b,uint8_t domain,int *out,unsigned char key[32],unsigned char release[32]){
 *out=-1;if(!b||b->child_pid!=(uint32_t)getpid()||b->uid!=(uint32_t)getuid()||getuid()!=geteuid()||!mi_derive_key(b,domain,key))return 0;
 int fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd<0)return 0;*out=fd;int flags=fcntl(fd,F_GETFL);if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK)||fcntl(fd,F_SETFD,FD_CLOEXEC))goto bad;
#ifdef SO_NOSIGPIPE
 int yes=1;if(setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes)))goto bad;
#endif
 struct sockaddr_un addr;memset(&addr,0,sizeof(addr));addr.sun_family=AF_UNIX;const char path[]=MI_FIXED_ROOT "/" MI_SOCKET_BASENAME;if(sizeof(path)>sizeof(addr.sun_path))goto bad;memcpy(addr.sun_path,path,sizeof(path));
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;if(connect(fd,(struct sockaddr*)&addr,sizeof(addr))&&errno!=EINPROGRESS)goto bad;if(!wait_fd(fd,POLLOUT,deadline))goto bad;int error=0;socklen_t len=sizeof(error);if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&len)||error)goto bad;
 uint32_t peer,uid;if(!mi_peer_identity(fd,&peer,&uid)||peer!=b->helper_pid)goto bad;
#ifdef MI_FIXTURE_BUILD
 if(uid!=(uint32_t)getuid())goto bad;
#else
 if(uid!=0)goto bad;
#endif
 mi_frame f={0},reply={0};unsigned char client_nonce[32],answer[64],final[32];if(!mi_random(client_nonce,32))goto bad;
 f.domain=domain;f.operation=MI_HELLO;f.payload_length=32;memcpy(f.nonce,b->nonce,32);
 if(!mi_wire_send(fd,key,&f,client_nonce,deadline)||!mi_wire_receive(fd,key,&reply,answer,sizeof(answer),deadline)||reply.domain!=domain||reply.operation!=(MI_HELLO|MI_RESPONSE)||reply.status||reply.sequence||reply.slot||reply.offset||reply.payload_length!=64||reply.amount||memcmp(reply.nonce,b->nonce,32))goto bad;
 if(!mi_finalize_key(b,domain,client_nonce,answer,answer+32,final))goto bad;
 memcpy(release,answer+32,32);mi_zero(key,32);memcpy(key,final,32);mi_zero(final,32);mi_zero(answer,64);mi_zero(client_nonce,32);*out=fd;return 1;
bad: mi_zero(key,32);return 0;
}
