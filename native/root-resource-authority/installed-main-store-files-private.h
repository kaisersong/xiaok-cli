/* Same original translation unit, exact contiguous function group. Not a public header. */
static nr_root_store_file *new_store_file(nr_root_store_io *io,uint16_t slot,int readonly){
 nr_root_store_file *file=calloc(1,sizeof(*file));if(!file)return NULL;
 file->io=io;file->slot=slot;file->readonly=readonly;file->next=io->files;io->files=file;
 return file;
}
int nr_root_store_open_database(nr_root_store_io *io,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->open_database(io,out);return ok&&retain_imported_file(remote,*out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 nr_root_store_identity identity;
 if(!out||!store_association(io)||io->client->close_requested||io->main_opened||!nr_root_store_read_identity(io,&identity)||identity.birth_state<NR_CLAIMED)return 0;
 nr_root_store_file *file=new_store_file(io,MI_DATABASE,0);if(!file)return store_failed(io,ENOMEM);
 io->main_opened=1;io->database=file;io->open_files++;*out=file;return 1;
}
static int journal_open(nr_root_store_io *io,int mode,int create,int *present,nr_root_store_file **out){
 if(!out||!present||!store_association(io)||io->client->close_requested||!io->database||io->database->closed||io->identity.birth_state<NR_CLAIMED)return 0;
 for(nr_root_store_file *f=io->files;f;f=f->next)if(f->slot==MI_JOURNAL&&!f->closed)return 0;
 nr_root_store_file *file=new_store_file(io,MI_JOURNAL,mode==NR_READONLY);if(!file)return store_failed(io,ENOMEM);
 unsigned char body[4],bytes[NR_ROOT_IDENTITY_WIRE_BYTES];nr_io_put32(body,(uint32_t)mode);mi_frame reply={0};nr_root_store_identity next;
 if(!store_request(io,create?MI_JOURNAL_CREATE:MI_JOURNAL_OPEN_EXISTING,MI_JOURNAL,0,create?NULL:body,create?0:4,0,&reply,bytes,sizeof(bytes))||
    reply.offset||reply.amount||!nr_io_identity_decode(bytes,reply.payload_length,&next)||!nr_io_identity_same(&io->identity,&next)||
    next.receipt_sequence<io->identity.receipt_sequence)return store_failed(io,EPROTO);
 io->identity=next;
 if(!next.journal_present){file->closed=1;io->journal_owner=NULL;*present=0;*out=NULL;return create?store_failed(io,EPROTO):1;}
 if(!nr_io_nonzero(next.journal_ticket)||!next.journal_generation)return store_failed(io,EPROTO);
 file->generation=next.journal_generation;memcpy(file->ticket,next.journal_ticket,32);io->journal_owner=file;io->open_files++;
 *present=1;*out=file;return 1;
}
int nr_root_store_open_journal(nr_root_store_io *io,enum nr_root_open_mode mode,int *present,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->open_journal(io,mode,present,out);return ok&&retain_imported_file(remote,*out);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(mode!=NR_READONLY&&mode!=NR_READWRITE)return 0;
 return journal_open(io,mode,0,present,out);
}
int nr_root_store_create_journal(nr_root_store_io *io,nr_root_store_file **out){
 imported_store *remote=imported_io(io);if(remote){if(!out)return 0;int ok=remote->ops->create_journal(io,out);return ok&&retain_imported_file(remote,*out);}
 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 int present=0;return journal_open(io,NR_READWRITE,1,&present,out);}
static int file_ready(nr_root_store_file *file,int writing){
 return store_file(file)&&!file->closed&&(!writing||!file->readonly)&&
  (file->slot!=MI_JOURNAL||(file->io->journal_owner==file&&file->io->database&&!file->io->database->closed))&&store_alive(file->io,0);
}
static uint32_t file_body(nr_root_store_file *file,unsigned char *body){
 if(file->slot!=MI_JOURNAL)return 0;
 nr_io_put64(body,file->generation);memcpy(body+8,file->ticket,32);return 40;
}
int nr_root_store_read_at(nr_root_store_file *file,uint64_t offset,void *output,uint32_t amount,uint32_t *actual){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->read_at(file,offset,output,amount,actual);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!output||!actual||!file_ready(file,0)||!amount||amount>(file->io->family?MI_AUTHORITY_MAX_READ:MI_MAX_PAYLOAD)||offset>INT64_MAX-amount)return 0;
 unsigned char body[40];uint32_t length=file_body(file,body);mi_frame reply={0};
 if(!store_request(file->io,MI_READ,file->slot,offset,body,length,amount,&reply,output,amount)||reply.offset!=offset||reply.amount||reply.payload_length>amount)return store_failed(file->io,EPROTO);
 *actual=reply.payload_length;return 1;
}
int nr_root_store_write_at(nr_root_store_file *file,uint64_t offset,const void *input,uint32_t amount,uint32_t *actual){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->write_at(file,offset,input,amount,actual);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!input||!actual||!file_ready(file,1)||!amount||amount>(file->io->family?(file->slot==MI_JOURNAL?MI_AUTHORITY_MAX_JOURNAL_WRITE:MI_AUTHORITY_MAX_INNER):(file->slot==MI_JOURNAL?MI_MAX_PAYLOAD-40:MI_MAX_PAYLOAD))||offset>INT64_MAX-amount)return 0;
 unsigned char body[MI_MAX_PAYLOAD],unused[1];uint32_t length=file_body(file,body);memcpy(body+length,input,amount);mi_frame reply={0};
 if(!store_request(file->io,MI_WRITE,file->slot,offset,body,length+amount,amount,&reply,unused,0)||reply.offset!=offset||reply.payload_length||reply.amount!=amount)return store_failed(file->io,EPROTO);
 *actual=reply.amount;return 1;
}
int nr_root_store_size(nr_root_store_file *file,uint64_t *size){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->size(file,size);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!size||!file_ready(file,0))return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_SIZE,file->slot,0,body,length,0,&reply,unused,0)||reply.payload_length||reply.amount||reply.offset>INT64_MAX)return store_failed(file->io,EPROTO);
 *size=reply.offset;return 1;
}
int nr_root_store_truncate(nr_root_store_file *file,uint64_t size){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->truncate(file,size);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!file_ready(file,1)||size>INT64_MAX)return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_TRUNCATE,file->slot,size,body,length,0,&reply,unused,0)||reply.offset!=size||reply.payload_length||reply.amount)return store_failed(file->io,EPROTO);return 1;
}
int nr_root_store_sync(nr_root_store_file *file){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->sync(file);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!file_ready(file,0))return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};uint32_t length=file_body(file,body);
 if(!store_request(file->io,MI_SYNC,file->slot,0,body,length,0,&reply,unused,0)||reply.offset||reply.payload_length||reply.amount)return store_failed(file->io,EPROTO);return 1;
}
int nr_root_store_close_file(nr_root_store_file *file){
 imported_store *remote=imported_file(file);if(remote){return remote->ops->close_file(file);}

 if(!store_file(file))return 0;
 NM_CLIENT_GUARD(file->io->client,0);
 if(!store_file(file)||!store_association(file->io))return 0;if(file->closed)return !file->io->unknown;
 if(file->slot==MI_JOURNAL){
  unsigned char body[40],unused[1];mi_frame reply={0};file_body(file,body);
  if(!store_request(file->io,MI_JOURNAL_CLOSE,MI_JOURNAL,0,body,40,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(file->io,EPROTO);
 }
 file->closed=1;file->io->open_files--;return 1;
}
int nr_root_store_delete_journal(nr_root_store_io *io,uint64_t generation,const unsigned char ticket[32]){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->delete_journal(io,generation,ticket);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!ticket||!store_association(io))return 0;nr_root_store_file *original=NULL;
 for(nr_root_store_file *f=io->files;f;f=f->next)if(f->slot==MI_JOURNAL&&f->generation==generation&&!memcmp(f->ticket,ticket,32)){original=f;break;}
 if(!original||original!=io->journal_owner||!original->closed||!io->database||io->database->closed)return 0;
 unsigned char body[40],unused[1];mi_frame reply={0};file_body(original,body);
 if(!store_request(io,MI_JOURNAL_DELETE,MI_JOURNAL,0,body,40,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(io,EPROTO);return 1;
}
int nr_root_store_directory_sync(nr_root_store_io *io){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->directory_sync(io);}

 if(!store_member(io))return 0;
 NM_CLIENT_GUARD(io->client,0);
 if(!store_association(io))return 0;unsigned char unused[1];mi_frame reply={0};
 if(!store_request(io,MI_DIRECTORY_SYNC,MI_DATABASE,0,NULL,0,0,&reply,unused,0)||reply.offset||reply.amount||reply.payload_length)return store_failed(io,EPROTO);return 1;
}
enum nr_root_release_result nr_root_store_release_owned(nr_root_store_io *io){
 imported_store *remote=imported_io(io);if(remote){return remote->ops->release_owned(io);}

 if(!store_member(io))return NR_UNKNOWN_HELD;
 NM_CLIENT_GUARD(io->client,NR_UNKNOWN_HELD);
 if(store_member(io)&&io->released&&io->pid==getpid()&&pthread_equal(io->thread,pthread_self()))return NR_SQL_FILES_CLOSED;
 if(!store_association(io))return NR_UNKNOWN_HELD;
 if(io->unknown||io->client->fate.unknown)return NR_UNKNOWN_HELD;
 if(io->open_files)return NR_BUSY_HELD;
 if(io->family){unsigned char bytes[MI_AUTHORITY_RESULT_PREFIX];mi_frame reply={0},result={0};
  if(!authority_exchange(io,MI_AUTHORITY_RELEASE,io->authority_token,32,bytes,sizeof(bytes),&reply)||!authority_result(io,bytes,reply.payload_length,&result,NULL,0)||result.offset||result.amount||result.payload_length)return NR_UNKNOWN_HELD;
  if(!io->authority_hold||!io->client->authority_holds)return NR_UNKNOWN_HELD;
  io->authority_hold=0;io->client->authority_holds--;
 }
 io->released=1;return NR_SQL_FILES_CLOSED;
}

const nm_root_store_dispatch *nm_installed_root_store_dispatch(void){
 static const nm_root_store_dispatch ops={NR_STORE_DISPATCH_MAGIC,NR_STORE_DISPATCH_VERSION,sizeof(nm_root_store_dispatch),nr_root_store_read_identity,nr_root_store_claim_fresh,nr_root_store_read_claim,nr_root_store_bind_bootstrap,nr_root_store_open_database,nr_root_store_open_journal,nr_root_store_create_journal,nr_root_store_read_at,nr_root_store_write_at,nr_root_store_size,nr_root_store_truncate,nr_root_store_sync,nr_root_store_close_file,nr_root_store_delete_journal,nr_root_store_directory_sync,nr_root_store_release_owned,nr_root_store_read_adoption_kind,nr_root_store_claim_adopted,nr_root_store_read_adoption};
 return &ops;
}

int nm_installed_root_store_close_ready(nm_installed_client *client,nr_root_store_io *io){
 NM_CLIENT_GUARD(client,-1);
 if(!original_member(client)||!store_member(io)||io->client!=client||client->root_store!=io||io->unknown||client->fate.unknown)return -1;
 if(client->authority_holds||client->worker_holds)return 0;
 return 1;
}

/* Fixed budget Worker leases. Records predate OPEN and remain tombstones.
 * Only the original CPP source supplies the actual Node thread identity. */
