#ifndef XIAOK_FIXED_BROKER_CHILD_DELEGATION_H
#define XIAOK_FIXED_BROKER_CHILD_DELEGATION_H
#include "../broker-authority-source/broker-protocol.h"
/* Included only by the original helper. No generic child/family registration. */
static int br_closure(state *s){
 struct stat launcher,executable;unsigned char digest[32];
 if(!hash_file(MI_BROKER_LAUNCHER_EXEC,digest,&launcher)||!S_ISREG(launcher.st_mode)||launcher.st_nlink!=1||(launcher.st_mode&0022)||!(launcher.st_mode&0111))return 0;
 if(!hash_file(MI_BROKER_EXEC,digest,&executable)||!S_ISREG(executable.st_mode)||executable.st_nlink!=1||(executable.st_mode&0022)||!(executable.st_mode&0111))return 0;
#ifdef MI_FIXTURE_BUILD
 unsigned char expected[32];if(launcher.st_uid!=getuid()||executable.st_uid!=getuid()||!hex_digest(MI_EXPECTED_BROKER_SHA256,expected)||memcmp(digest,expected,32))return 0;
#else
 unsigned char release[32];struct stat main;
 if(launcher.st_uid!=0||executable.st_uid!=0||!mi_signed_path(MI_BROKER_LAUNCHER_EXEC,"com.xiaok.broker-child-launcher",0)||!mi_release_digest(release,&main,0)||memcmp(release,s->release,32))return 0;
#endif
 s->br.launcher=launcher;s->br.executable=executable;return 1;
}
static int br_process(state *s,uint32_t pid,int launching){
#ifdef __APPLE__
 struct proc_bsdinfo actual;char path[PROC_PIDPATHINFO_MAXSIZE];
 if(!pid||proc_pidinfo((int)pid,PROC_PIDTBSDINFO,0,&actual,sizeof(actual))!=(int)sizeof(actual)||actual.pbi_uid!=s->birth.uid||actual.pbi_ruid!=s->birth.uid||actual.pbi_ppid!=(uint32_t)s->child||proc_pidpath((int)pid,path,sizeof(path))<=0||strcmp(path,launching?MI_BROKER_LAUNCHER_EXEC:MI_BROKER_EXEC))return 0;
 if(launching)s->br.process=actual;else if(actual.pbi_start_tvsec!=s->br.process.pbi_start_tvsec||actual.pbi_start_tvusec!=s->br.process.pbi_start_tvusec)return 0;
 return 1;
#else
 (void)s;(void)pid;(void)launching;return 0;
#endif
}
static int br_control(state *s,const mi_frame *f,const unsigned char *input,mi_frame *r,unsigned char *output){
 if(f->domain!=MI_ROOT_IO||f->slot||f->amount||f->offset||f->status)return 0;
 if(f->operation==MI_BROKER_PREPARE){
  if(f->payload_length!=32||s->br.prepared)return 0;
  mi_store_lease *lease=authority_token(s,input);
  if(!lease||lease->family!=MI_FAMILY_BROKER||!authority_current(s,lease)||!br_closure(s))return 0;
  /* Reservation precedes random/peer/spawn work. A partial failure is sticky. */
  s->br.prepared=1;s->br.lease=lease;s->br.birth.helper_pid=(uint32_t)getpid();s->br.birth.uid=s->birth.uid;
  if(!mi_random(s->br.birth.nonce,32)||!mi_random(s->br.birth.seed,32)){s->br.unknown=1;return 0;}
  memcpy(output,s->br.birth.nonce,32);memcpy(output+32,s->br.birth.seed,32);r->payload_length=64;return 1;
 }
 if(f->operation==MI_BROKER_PUBLISH){
  if(f->payload_length!=36||!s->br.prepared||s->br.published||s->br.unknown||!s->br.lease||memcmp(input,s->br.lease->token,32))return 0;
  uint32_t pid=st_u32(input+32);s->br.published=1;s->br.birth.child_pid=pid;
  if(!br_process(s,pid,1)){s->br.unknown=1;return 0;}
  return mi_birth_encode(&s->br.birth,output)&&(r->payload_length=MI_BIRTH_BYTES);
 }
 if(f->operation==MI_BROKER_RETIRE){
  if(f->payload_length!=32||!s->br.prepared||s->br.retired||!s->br.lease||memcmp(input,s->br.lease->token,32))return 0;
  /* This request is emitted only by the Native producer after original waitpid,
   * or before spawn entry. Child IO must already have closed its own lease. */
  if(s->br.published&&(!s->br.files_closed||!s->br.terminal))return 0;
  s->br.retired=1;mi_zero(s->br.birth.seed,32);return 1;
 }
 return 0;
}
static int br_peer(state *s,int fd){
 uint32_t pid,uid;return s->br.published&&!s->br.retired&&!s->br.unknown&&mi_peer_identity(fd,&pid,&uid)&&pid==s->br.birth.child_pid&&uid==s->birth.uid&&br_process(s,pid,0);
}
static int br_io(state *s,const mi_frame *f,const unsigned char *input,mi_frame *r,unsigned char *output){
 if(f->domain!=MI_BROKER_IO||f->slot||f->amount||f->offset||f->status||!s->br.lease)return 0;
 mi_store_lease *lease=s->br.lease;
 if(f->operation==MI_PING)return !f->payload_length&&!lease->closed&&authority_current(s,lease);
 if(f->operation==MI_CLOSE){
  if(f->payload_length)return 0;int good=authority_close(s,lease);s->br.files_closed=good;s->br.terminal=good;if(!good){s->br.unknown=1;r->status=EIO;}return 1;
 }
 if(f->operation==MI_AUTHORITY_RELEASE){
  if(f->payload_length!=32||memcmp(input,lease->token,32))return 0;
  mi_frame original=*f;original.domain=MI_ROOT_IO;int good=authority_io(s,&original,input,r,output);
  if(good&&r->payload_length>=24&&st_u32(output)==MI_AUTHORITY_OK)s->br.files_closed=1;
  return good;
 }
 if(f->operation!=MI_AUTHORITY_REQUEST||f->payload_length<MI_AUTHORITY_REQUEST_PREFIX||memcmp(input,lease->token,32))return 0;
 /* Use exactly the existing fixed family codec. Root/other family operations
  * and new family OPEN/RELEASE never cross this delegated domain. */
 mi_frame original=*f;original.domain=MI_ROOT_IO;return authority_io(s,&original,input,r,output);
}
#endif
