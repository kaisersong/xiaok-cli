#ifndef XIAOK_BROKER_CLIENT_PRIVATE_H
#define XIAOK_BROKER_CLIENT_PRIVATE_H
/* Included by the single original client producer, after its private KS row. */
static int br_exchange(nm_broker_child_birth *r,uint16_t operation,const unsigned char *body,uint32_t size,unsigned char *out,size_t capacity,mi_frame *reply){
 nm_installed_client *p=r->client;nm_channel *c=p->channels;
 if(!original_member(p)||c->fd<0||!c->key_valid||c->close_attempted||c->next_sequence==UINT64_MAX||!channel_peer(p,c))return 0;
 if(operation!=MI_BROKER_RETIRE&&!nm_installed_current(p))return 0;
 mi_frame request={0};request.domain=MI_ROOT_IO;request.operation=operation;request.sequence=c->next_sequence;request.payload_length=size;memcpy(request.nonce,p->birth.nonce,32);
 uint64_t deadline=mi_now_ms()+MI_FRAME_TIMEOUT_MS;
 int good=mi_wire_send(c->fd,c->key,&request,body,deadline)&&mi_wire_receive(c->fd,c->key,reply,out,capacity,deadline)&&reply->domain==MI_ROOT_IO&&reply->operation==(operation|MI_RESPONSE)&&reply->sequence==request.sequence&&!reply->status&&!reply->slot&&!reply->offset&&!reply->amount&&!memcmp(reply->nonce,p->birth.nonce,32);
 if(!good){r->unknown=1;unknown(p,errno?errno:EPROTO);return 0;}c->next_sequence++;return 1;
}
static int br_close_descriptor(nm_broker_child_birth *r,int *fd){
 if(*fd<0)return 1;int original=*fd;*fd=-1;if(close(original)){if(r->failed_fd_count<8)r->failed_fds[r->failed_fd_count++]=original;r->unknown=1;unknown(r->client,errno);return 0;}return 1;
}
int nm_broker_child_launch(nm_broker_child_birth *candidate){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self()))return 0;
 NM_CLIENT_GUARD(r->client,0);if(r->entered||r->cancelled||r->unknown||!r->io||!nm_installed_current(r->client))return 0;
 r->entered=1;mi_frame reply={0};unsigned char answer[MI_BROKER_PREPARE_REPLY_BYTES];
 if(!br_exchange(r,MI_BROKER_PREPARE,r->io->authority_token,32,answer,sizeof(answer),&reply)||reply.payload_length!=sizeof(answer))return 0;
 r->prepared=1;int channel[2]={-1,-1},ipc[2]={-1,-1},output[2]={-1,-1},errors[2]={-1,-1};
 if(pipe(channel)||pipe(output)||pipe(errors)||socketpair(AF_UNIX,SOCK_STREAM,0,ipc)){r->unknown=1;unknown(r->client,errno);goto done;}
 for(int i=0;i<2;i++)if(fcntl(channel[i],F_SETFD,FD_CLOEXEC)||fcntl(ipc[i],F_SETFD,FD_CLOEXEC)||fcntl(output[i],F_SETFD,FD_CLOEXEC)||fcntl(errors[i],F_SETFD,FD_CLOEXEC)){r->unknown=1;unknown(r->client,errno);goto done;}
 /* Relocate every owned collision before file-actions can overwrite 1/2/3/198. */
 int *groups[]={channel,ipc,output,errors};
 for(size_t group=0;group<4;group++)for(int index=0;index<2;index++)if(groups[group][index]<=3||groups[group][index]==MI_BIRTH_FD){
  int original=groups[group][index],copy=fcntl(original,F_DUPFD_CLOEXEC,MI_BIRTH_FD+1);
  if(copy<0){r->unknown=1;unknown(r->client,errno);goto done;}
  groups[group][index]=copy;if(close(original)){if(r->failed_fd_count<8)r->failed_fds[r->failed_fd_count++]=original;r->unknown=1;unknown(r->client,errno);goto done;}
 }
 posix_spawn_file_actions_t actions;int actions_ready=posix_spawn_file_actions_init(&actions)==0;
 int good=actions_ready&&!posix_spawn_file_actions_adddup2(&actions,channel[0],MI_BIRTH_FD)&&!posix_spawn_file_actions_adddup2(&actions,ipc[1],3)&&!posix_spawn_file_actions_addclose(&actions,channel[0])&&!posix_spawn_file_actions_addclose(&actions,channel[1])&&!posix_spawn_file_actions_addclose(&actions,ipc[0]);
 if(good&&ipc[1]!=3)good=!posix_spawn_file_actions_addclose(&actions,ipc[1]);
 if(good)good=!posix_spawn_file_actions_adddup2(&actions,output[1],1)&&!posix_spawn_file_actions_adddup2(&actions,errors[1],2);
 for(int i=0;i<2&&good;i++)good=!posix_spawn_file_actions_addclose(&actions,output[i])&&!posix_spawn_file_actions_addclose(&actions,errors[i]);
 char *args[]={(char*)MI_BROKER_LAUNCHER_EXEC,NULL},*environment[]={"PATH=/usr/bin:/bin","LC_ALL=C",NULL};pid_t pid=-1;
 r->spawn_entered=good;int error=good?posix_spawn(&pid,MI_BROKER_LAUNCHER_EXEC,&actions,NULL,args,environment):EPERM;
 if(actions_ready){int destroyed=posix_spawn_file_actions_destroy(&actions);if(destroyed){r->unknown=1;unknown(r->client,destroyed);}}
 if(error){errno=error;r->unknown=1;unknown(r->client,error);goto done;}
 r->child=pid;r->ipc=ipc[0];r->stdout_fd=output[0];r->stderr_fd=errors[0];ipc[0]=output[0]=errors[0]=-1;
 unsigned char publish[36],birth[MI_BROKER_BIRTH_BYTES];memcpy(publish,r->io->authority_token,32);nr_io_put32(publish+32,(uint32_t)pid);
 if(!br_exchange(r,MI_BROKER_PUBLISH,publish,sizeof(publish),birth,MI_BIRTH_BYTES,&reply)||reply.payload_length!=MI_BIRTH_BYTES){r->unknown=1;goto done;}
 mi_birth decoded;if(!mi_birth_decode(birth,&decoded)||decoded.child_pid!=(uint32_t)pid||decoded.helper_pid!=r->client->birth.helper_pid||decoded.uid!=r->client->birth.uid||memcmp(decoded.nonce,answer,32)||memcmp(decoded.seed,answer+32,32)){r->unknown=1;unknown(r->client,EPROTO);goto done;}
 nr_io_put32(birth+88,(uint32_t)getpid());memcpy(birth+92,r->io->authority_token,32);memcpy(birth+124,r->io->scope,32);memcpy(birth+156,r->client->root_store->identity.pool_id,32);
 good=mi_write_exact(channel[1],birth,sizeof(birth),mi_now_ms()+MI_FRAME_TIMEOUT_MS);mi_zero(birth,sizeof(birth));mi_zero(&decoded,sizeof(decoded));
 if(!good){r->unknown=1;unknown(r->client,errno);}
 r->launched=good;
done:
 for(int i=0;i<2;i++){br_close_descriptor(r,channel+i);br_close_descriptor(r,ipc+i);br_close_descriptor(r,output+i);br_close_descriptor(r,errors+i);}mi_zero(answer,sizeof(answer));return r->launched&&!r->unknown;
}
int nm_broker_child_poll_owned(nm_broker_child_birth *candidate){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self()))return -1;
 NM_CLIENT_GUARD(r->client,-1);if(!r->spawn_entered||r->child<=0)return -1;if(r->waited)return 1;
 pid_t actual;do{actual=waitpid(r->child,&r->wait_status,WNOHANG);}while(actual<0&&errno==EINTR);
 if(!actual)return 0;if(actual==r->child){r->waited=1;return 1;}r->wait_lost=1;r->unknown=1;unknown(r->client,errno);return -1;
}
int nm_broker_child_read_stream(nm_broker_child_birth *candidate,int stream,void *buffer,uint32_t capacity,uint32_t *actual){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self())||!buffer||!actual||!capacity||capacity>65536||stream<1||stream>3)return -1;
 NM_CLIENT_GUARD(r->client,-1);*actual=0;int *fd=stream==1?&r->stdout_fd:stream==2?&r->stderr_fd:&r->ipc;if(*fd<0)return 0;
 int flags=fcntl(*fd,F_GETFL);if(flags<0||fcntl(*fd,F_SETFL,flags|O_NONBLOCK)){r->unknown=1;unknown(r->client,errno);return -1;}
 ssize_t n;do{n=read(*fd,buffer,capacity);}while(n<0&&errno==EINTR);
 if(n>0){*actual=(uint32_t)n;return 1;}if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK))return 2;
 if(!n)return br_close_descriptor(r,fd)?0:-1;r->unknown=1;unknown(r->client,errno);return -1;
}
int nm_broker_child_write_business(nm_broker_child_birth *candidate,const void *bytes,uint32_t size,uint32_t *actual){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self())||!bytes||!actual||!size||size>65536)return 0;
 NM_CLIENT_GUARD(r->client,0);*actual=0;if(!r->launched||r->waited||r->unknown||r->ipc<0||!nm_installed_current(r->client))return 0;
 ssize_t n;do{n=send(r->ipc,bytes,size,MSG_DONTWAIT|MSG_NOSIGNAL);}while(n<0&&errno==EINTR);
 if(n>0){*actual=(uint32_t)n;return 1;}if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK))return 1;r->unknown=1;unknown(r->client,errno);return 0;
}
int nm_broker_child_signal_owned(nm_broker_child_birth *candidate,int value){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self())||(value!=SIGTERM&&value!=SIGKILL))return 0;
 NM_CLIENT_GUARD(r->client,0);if(r->child<=0||r->waited||r->wait_lost)return 0;if(kill(r->child,value)){r->unknown=1;unknown(r->client,errno);return 0;}return 1;
}
int nm_broker_child_wait_owned(nm_broker_child_birth *candidate){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self()))return 0;
 NM_CLIENT_GUARD(r->client,0);if(!r->spawn_entered||r->child<=0)return 0;
 if(!r->waited){pid_t actual;do{actual=waitpid(r->child,&r->wait_status,0);}while(actual<0&&errno==EINTR);if(actual!=r->child){r->wait_lost=1;r->unknown=1;unknown(r->client,errno);return 0;}r->waited=1;}
 if(r->ipc>=0||r->stdout_fd>=0||r->stderr_fd>=0)return 0;
 int good=1;unsigned char output[1];mi_frame reply={0};
 if(!r->retired&&r->prepared){if(br_exchange(r,MI_BROKER_RETIRE,r->io->authority_token,32,output,sizeof(output),&reply)&&!reply.payload_length)r->retired=1;else good=0;}
 if(!r->waited||r->unknown||!r->retired)return 0;
 /* Child's fixed CLOSE ACK was required by helper before RETIRE. Original
  * parent row consumes that private terminal result; not caller known data. */
 if(r->io->authority_hold&&r->client->authority_holds){r->io->authority_hold=0;r->client->authority_holds--;r->io->released=1;}
 r->cancelled=1;return good;
}
int nm_broker_child_assert_terminal(nm_broker_child_birth *candidate){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self()))return 0;
 NM_CLIENT_GUARD(r->client,0);if(r->unknown||!r->cancelled||!r->io||!r->io->released)return 0;
 return !r->entered||(r->waited&&r->retired&&r->ipc<0&&r->stdout_fd<0&&r->stderr_fd<0);
}
int nm_broker_child_read_fate(nm_broker_child_birth *candidate,int *pid,int *status,int *known){
 nm_broker_child_birth *r=broker_birth_member(candidate);if(!r||r->pid!=getpid()||!pthread_equal(r->thread,pthread_self())||!pid||!status||!known)return 0;
 NM_CLIENT_GUARD(r->client,0);*pid=(int)r->child;*status=r->wait_status;*known=r->waited&&r->retired&&!r->unknown;return 1;
}
const nm_broker_child_dispatch *nm_original_broker_child_dispatch(void){
 static const nm_broker_child_dispatch ops={nm_broker_child_launch,nm_broker_child_cancel_unlaunched,nm_broker_child_wait_owned,nm_broker_child_poll_owned,nm_broker_child_read_stream,nm_broker_child_write_business,nm_broker_child_signal_owned,nm_broker_child_assert_terminal,nm_broker_child_read_fate};return &ops;
}
#endif
