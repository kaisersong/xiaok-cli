#ifndef XIAOK_ENROLLMENT_CUSTODY_HELPER_H
#define XIAOK_ENROLLMENT_CUSTODY_HELPER_H
/* Only Native inherited control can reach this pre-namespace receiver. Actual
 * descriptors remain owned here; receiving them is not approval/adoption. */
static MI_CU_UNUSED int mi_entry_receive(state *s){
#ifdef MI_FIXTURE_BUILD
 const uint32_t kind=2;
#else
 const uint32_t kind=1;
#endif
 mi_custody_birth *b=&s->enrollment_birth;
 struct proc_bsdinfo parent;
 if(!mi_cu_parent(kind,&parent)||!mi_cu_socket(MI_CUSTODY_HELPER_FD,parent.pbi_uid))return 0;
 s->enrollment_control=MI_CUSTODY_HELPER_FD;
 if(!mi_cu_read_birth(s->enrollment_control,2,kind,b))return mi_cu_fail(&s->enrollment_custody,errno);
#ifndef MI_FIXTURE_BUILD
 if(b->uid!=s->birth.uid)return mi_cu_fail(&s->enrollment_custody,EPERM);
#endif
 if(!mi_cu_receive_fds(s->enrollment_control,b,&s->enrollment_custody))return 0;
 unsigned char ack[40];memcpy(ack,"XMFDACK1",8);memcpy(ack+8,b->nonce,32);
 if(!mi_cu_write(s->enrollment_control,ack,sizeof(ack)))return mi_cu_fail(&s->enrollment_custody,errno);
 return 1;
}
static MI_CU_UNUSED int mi_entry_current(state *s){
 mi_custody_received *r=&s->enrollment_custody;struct stat actual,named;
 if(!r->entered||r->unknown||r->closed)return 0;
 for(int i=0;i<3;i++){
  if(r->fds[i]<0||fstat(r->fds[i],&actual)||actual.st_dev!=r->facts[i].st_dev||actual.st_ino!=r->facts[i].st_ino||actual.st_uid!=r->facts[i].st_uid||actual.st_mode!=r->facts[i].st_mode)return mi_cu_fail(r,errno);
  if(i&&actual.st_nlink!=1)return mi_cu_fail(r,EINVAL);
  if(i==2&&(actual.st_size!=r->facts[i].st_size||actual.st_mtimespec.tv_sec!=r->facts[i].st_mtimespec.tv_sec||actual.st_mtimespec.tv_nsec!=r->facts[i].st_mtimespec.tv_nsec||actual.st_ctimespec.tv_sec!=r->facts[i].st_ctimespec.tv_sec||actual.st_ctimespec.tv_nsec!=r->facts[i].st_ctimespec.tv_nsec))return mi_cu_fail(r,EINVAL);
 }
 if(fstatat(r->fds[0],"issuer.lock",&named,AT_SYMLINK_NOFOLLOW)||named.st_dev!=r->facts[1].st_dev||named.st_ino!=r->facts[1].st_ino||fstatat(r->fds[0],"root-resource-v1.sqlite",&named,AT_SYMLINK_NOFOLLOW)||named.st_dev!=r->facts[2].st_dev||named.st_ino!=r->facts[2].st_ino)return mi_cu_fail(r,EINVAL);
 return mi_cu_fixed_directory(&s->enrollment_birth,r);
}
static int mi_entry_close(state *s){
 int good=mi_cu_close(&s->enrollment_custody);
 if(s->enrollment_control>=0){
  if(s->enrollment_control_close_entered)good=0;
  else{s->enrollment_control_close_entered=1;int original=s->enrollment_control;
   if(close(original)){mi_cu_fail(&s->enrollment_custody,errno);good=0;}else s->enrollment_control=-1;
  }
 }
 if(s->enrollment_custody.unknown)s->unknown=1;return good&&!s->enrollment_custody.unknown;
}
#ifdef MI_CUSTODY_TRANSPORT_COMPONENT
#ifndef MI_FIXTURE_BUILD
#error CUSTODY_COMPONENT_MUST_NOT_ENABLE_PRODUCTION_AUTHORITY
#endif
static int mi_entry_component(state *s){
 unsigned char command[40],ack[40];int good=mi_entry_receive(s);
 while(good){
  struct pollfd idle={s->enrollment_control,POLLIN,0};int polled;do{polled=poll(&idle,1,-1);}while(polled<0&&errno==EINTR);
  if(polled<1||!mi_cu_read(s->enrollment_control,command,sizeof(command))){good=0;break;}
  if(memcmp(command+8,s->enrollment_birth.nonce,32)){good=0;break;}
  if(!memcmp(command,"XMCLOSE1",8))break;
  if(memcmp(command,"XMCHECK1",8)||!mi_entry_current(s)){good=0;break;}
  memcpy(ack,"XMCURR01",8);memcpy(ack+8,s->enrollment_birth.nonce,32);if(!mi_cu_write(s->enrollment_control,ack,sizeof(ack))){good=0;break;}
 }
 if(!good)mi_cu_fail(&s->enrollment_custody,errno);
 int closed=mi_cu_close(&s->enrollment_custody);memcpy(ack,good&&closed?"XMCLOSEK":"XMUNKNO1",8);memcpy(ack+8,s->enrollment_birth.nonce,32);
 if(s->enrollment_control>=0&&!mi_cu_write(s->enrollment_control,ack,sizeof(ack)))mi_cu_fail(&s->enrollment_custody,errno);
 if(!mi_entry_close(s))closed=0;
 fprintf(stdout,"{\"scope\":\"custody-component-only\",\"pid\":%d,\"knownClosed\":%s,\"unknown\":%s,\"firstErrno\":%d,\"namespaceOpened\":false,\"mainLaunched\":false}\n",getpid(),good&&closed?"true":"false",s->enrollment_custody.unknown?"true":"false",s->enrollment_custody.first_errno);
 return good&&closed?0:79;
}
#endif
#endif
