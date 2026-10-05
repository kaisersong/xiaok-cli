/* Ordinary UID cooperative SQLite writer custody. This is not native-effect
 * drain or a complete profile inventory. Use the real unix VFS lock protocol. */
#define main source_hardlink_unused_main
#include "source-lock-custody.c"
#undef main
#include <sqlite3.h>
#define DBS 32
struct file_identity {int exists;dev_t device;ino_t inode;int fd;};
struct database_scope {char *path;char full[PATH_MAX];char *name;int directory;dev_t device;ino_t inode;struct file_identity files[4];sqlite3 *db;int page_size,page_count;};
static struct database_scope scopes[DBS];static int count,invalid,holding;
static sqlite3_vfs *original,guarded;
static const char *suffixes[]={"","-journal","-wal","-shm"};
static int (*original_close)(int);
static int reject(void){
#ifdef XIAOK_CUSTODY_TRACE
 fprintf(stderr,"reject errno=%d\n",errno);
#endif
 invalid=1;errno=EACCES;return -1;}
static int locate(const char *path,int *kind){if(!path)return reject();
#ifdef XIAOK_CUSTODY_TRACE
 fprintf(stderr,"path %s\n",path);
#endif
 for(int i=0;i<count;i++)for(int k=0;k<4;k++){char candidate[PATH_MAX];int n=snprintf(candidate,sizeof(candidate),"%s%s",scopes[i].full,suffixes[k]);if(n>0&&(size_t)n<sizeof(candidate)&&!strcmp(candidate,path)){*kind=k;return i;}}return reject();}
static int name_for(int i,int k,char name[NAME_MAX+1]){int n=snprintf(name,NAME_MAX+1,"%s%s",scopes[i].name,suffixes[k]);return n>0&&n<=NAME_MAX;}
static int metadata(int i,int k,struct stat *s){char name[NAME_MAX+1];if(!name_for(i,k,name))return reject();int result=fstatat(scopes[i].directory,name,s,AT_SYMLINK_NOFOLLOW);struct file_identity *known=&scopes[i].files[k];if(result){if(errno==ENOENT&&!known->exists)return -1;return reject();}if(!S_ISREG(s->st_mode)||s->st_nlink!=1||s->st_uid!=getuid()||!known->exists||s->st_dev!=known->device||s->st_ino!=known->inode)return reject();return 0;}
static int guarded_open(const char *path,int flags,int mode){
 (void)mode;
#ifdef XIAOK_CUSTODY_TRACE
 fprintf(stderr,"flags %x\n",flags);
#endif
 int k,i=locate(path,&k);if(i<0)return -1;struct file_identity *known=&scopes[i].files[k];char name[NAME_MAX+1];if(!name_for(i,k,name))return reject();
 int allowed=O_ACCMODE|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC;
#ifdef O_NOFOLLOW_ANY
 allowed|=O_NOFOLLOW_ANY;
#endif
#ifdef O_LARGEFILE
 allowed|=O_LARGEFILE;
#endif
 if(flags&~allowed||(flags&O_ACCMODE)!=O_RDWR||(!k&&(flags&O_CREAT)))return reject();
 if(!known->exists){if(!k||!(flags&O_CREAT))return reject();flags|=O_EXCL;}else{struct stat before;if(metadata(i,k,&before))return -1;flags&=~O_CREAT;}
 /* macOS rejects combining O_NOFOLLOW_ANY and O_NOFOLLOW. The parent is
  * already an exact nofollow-opened dirfd and name is a single basename. */
#ifdef O_NOFOLLOW_ANY
 flags&=~O_NOFOLLOW_ANY;
#endif
 int fd=openat(scopes[i].directory,name,flags|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0){invalid=1;return -1;}struct stat s;
 if(fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_nlink!=1||s.st_uid!=getuid()||(known->exists&&(s.st_dev!=known->device||s.st_ino!=known->inode))){close(fd);return reject();}
 if(known->fd>=0){close(fd);return reject();}known->exists=1;known->device=s.st_dev;known->inode=s.st_ino;known->fd=fd;return fd;
}
static int guarded_close(int fd){for(int i=0;i<count;i++)for(int k=0;k<4;k++)if(scopes[i].files[k].fd==fd){if(holding&&(k==0||k==3))invalid=1;scopes[i].files[k].fd=-1;}return original_close(fd);}
static int guarded_stat(const char *path,struct stat *s){int k,i=locate(path,&k);return i<0?-1:metadata(i,k,s);}
static int guarded_access(const char *path,int mode){if(mode!=F_OK&&mode!=R_OK&&mode!=W_OK&&mode!=(R_OK|W_OK))return reject();struct stat s;return guarded_stat(path,&s);}
static int guarded_unlink(const char *path){int k,i=locate(path,&k);if(i<0||k==0)return reject();struct stat s;if(metadata(i,k,&s)){if(!invalid&&errno==ENOENT)return -1;return reject();}char name[NAME_MAX+1];if(!name_for(i,k,name))return reject();int result=unlinkat(scopes[i].directory,name,0);if(result)return reject();scopes[i].files[k].exists=0;return 0;}
static int guarded_directory(const char *path,int *out){int k,i=locate(path,&k);if(i<0)return SQLITE_CANTOPEN;*out=fcntl(scopes[i].directory,F_DUPFD_CLOEXEC,3);return *out<0?SQLITE_CANTOPEN:SQLITE_OK;}
static char *guarded_getcwd(char *path,size_t size){(void)path;(void)size;reject();return NULL;}
static ssize_t guarded_readlink(const char *path,char *out,size_t size){(void)path;(void)out;(void)size;return reject();}
static int guarded_mkdir(const char *path,mode_t mode){(void)path;(void)mode;return reject();}
static int guarded_rmdir(const char *path){(void)path;return reject();}
static int fullpath(sqlite3_vfs *v,const char *path,int size,char *out){(void)v;int k;if(locate(path,&k)<0||k||strlen(path)>=(size_t)size)return SQLITE_CANTOPEN;memcpy(out,path,strlen(path)+1);return SQLITE_OK;}
static int file_open(sqlite3_vfs*v,const char*path,sqlite3_file*file,int flags,int*out){(void)v;int k,i=locate(path,&k);int common=SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_EXCLUSIVE|SQLITE_OPEN_NOFOLLOW;
 if(i<0||(flags&SQLITE_OPEN_READWRITE)==0)return SQLITE_CANTOPEN;
#ifdef SQLITE_OPEN_FILEPROTECTION_MASK
 int protection=flags&SQLITE_OPEN_FILEPROTECTION_MASK;
 if(protection&&protection!=SQLITE_OPEN_FILEPROTECTION_COMPLETE&&protection!=SQLITE_OPEN_FILEPROTECTION_COMPLETEUNLESSOPEN&&protection!=SQLITE_OPEN_FILEPROTECTION_COMPLETEUNTILFIRSTUSERAUTHENTICATION&&protection!=SQLITE_OPEN_FILEPROTECTION_NONE){invalid=1;return SQLITE_CANTOPEN;}
 common|=SQLITE_OPEN_FILEPROTECTION_MASK;
#endif
 int type=flags&~common;
 if((k==0&&type!=SQLITE_OPEN_MAIN_DB)||(k==1&&type!=SQLITE_OPEN_MAIN_JOURNAL)||(k==2&&type!=SQLITE_OPEN_WAL)||k==3||(k==0&&(flags&SQLITE_OPEN_CREATE))){invalid=1;return SQLITE_CANTOPEN;}
 return original->xOpen(original,path,file,flags,out);
}
static int private_randomness(sqlite3_vfs*v,int size,char*out){(void)v;if(size<0||!out)return 0;arc4random_buf(out,(size_t)size);return size;}
static void *no_extension(sqlite3_vfs*v,const char*p){(void)v;(void)p;invalid=1;return NULL;}
static int install_hooks(void){
 if(sqlite3_libversion_number()!=SQLITE_VERSION_NUMBER)return 0;original=sqlite3_vfs_find("unix");if(!original||original->iVersion<3||!original->xNextSystemCall||!original->xGetSystemCall||!original->xSetSystemCall)return 0;
 /* Fail on an unreviewed pathname syscall rather than silently delegating it. */
 const char *allowed[]={"open","close","access","getcwd","stat","fstat","ftruncate","fcntl","read","pread","pread64","write","pwrite","pwrite64","fchmod","fallocate","unlink","openDirectory","mkdir","rmdir","fchown","geteuid","mmap","munmap","mremap","getpagesize","readlink","lstat","ioctl"};
 const char *name=NULL;while((name=original->xNextSystemCall(original,name))){int found=0;for(unsigned i=0;i<sizeof(allowed)/sizeof(*allowed);i++)if(!strcmp(name,allowed[i]))found=1;if(!found)return 0;}
 original_close=(int(*)(int))original->xGetSystemCall(original,"close");if(!original_close)return 0;
#define HOOK(name,fn) do{if(!original->xGetSystemCall(original,name)||original->xSetSystemCall(original,name,(sqlite3_syscall_ptr)fn)!=SQLITE_OK)return 0;}while(0)
 HOOK("open",guarded_open);HOOK("close",guarded_close);HOOK("access",guarded_access);HOOK("getcwd",guarded_getcwd);HOOK("stat",guarded_stat);HOOK("lstat",guarded_stat);HOOK("unlink",guarded_unlink);HOOK("openDirectory",guarded_directory);HOOK("readlink",guarded_readlink);HOOK("mkdir",guarded_mkdir);HOOK("rmdir",guarded_rmdir);
#undef HOOK
 guarded=*original;guarded.zName="xiaok-approved-sources";guarded.xOpen=file_open;guarded.xFullPathname=fullpath;guarded.xDlOpen=no_extension;guarded.xRandomness=private_randomness;return sqlite3_vfs_register(&guarded,1)==SQLITE_OK;
}
static int parse_identity(const char *text,struct file_identity *f){f->fd=-1;if(!strcmp(text,"absent")){f->exists=0;return 1;}char *copy=strdup(text);if(!copy)return 0;char *colon=strchr(copy,':');unsigned long long device,inode;int okay=colon!=NULL;if(okay){*colon=0;okay=number(copy,&device)&&number(colon+1,&inode)&&inode>0;if(okay){f->exists=1;f->device=(dev_t)device;f->inode=(ino_t)inode;}}free(copy);return okay;}
static int pragma_integer(sqlite3 *db,const char *query,int *out){sqlite3_stmt *statement=NULL;int okay=sqlite3_prepare_v2(db,query,-1,&statement,NULL)==SQLITE_OK;if(okay)okay=sqlite3_step(statement)==SQLITE_ROW;if(okay){sqlite3_int64 value=sqlite3_column_int64(statement,0);okay=value>0&&value<=INT_MAX;if(okay)*out=(int)value;}if(statement&&sqlite3_finalize(statement)!=SQLITE_OK)okay=0;return okay;}
static int page_output(int index,int page,const char *nonce){struct database_scope *scope=&scopes[index];sqlite3_stmt *statement=NULL;int okay=sqlite3_prepare_v2(scope->db,"SELECT data FROM sqlite_dbpage('main') WHERE pgno=?",-1,&statement,NULL)==SQLITE_OK;if(okay)okay=sqlite3_bind_int(statement,1,page)==SQLITE_OK&&sqlite3_step(statement)==SQLITE_ROW;char encoded[131073];if(okay){int size=sqlite3_column_bytes(statement,0);const unsigned char *bytes=sqlite3_column_blob(statement,0);okay=size==scope->page_size&&size>0&&size<=65536&&bytes;if(okay){const char *hex="0123456789abcdef";for(int i=0;i<size;i++){encoded[i*2]=hex[bytes[i]>>4];encoded[i*2+1]=hex[bytes[i]&15];}encoded[size*2]=0;okay=sqlite3_step(statement)==SQLITE_DONE;}}if(statement&&sqlite3_finalize(statement)!=SQLITE_OK)okay=0;if(!okay||invalid)return 0;printf("{\"state\":\"page\",\"index\":%d,\"pageNo\":%d,\"nonce\":\"%s\",\"bytes\":\"%s\"}\n",index,page,nonce,encoded);return !ferror(stdout);}
static int held_output(const char *nonce){struct stat facts[DBS][4];for(int i=0;i<count;i++)for(int k=0;k<4;k++)if(scopes[i].files[k].exists&&(metadata(i,k,&facts[i][k])||facts[i][k].st_size<0))return 0;
 printf("{\"state\":\"held\",\"count\":%d,\"pid\":%ld,\"nonce\":\"%s\",\"snapshots\":[",count,(long)getpid(),nonce);
 for(int i=0;i<count;i++){printf("%s{\"index\":%d,\"pageSize\":%d,\"pageCount\":%d,\"physicalFiles\":[",i?",":"",i,scopes[i].page_size,scopes[i].page_count);int comma=0;for(int k=0;k<4;k++)if(scopes[i].files[k].exists){struct stat *f=&facts[i][k];printf("%s{\"suffix\":\"%s\",\"device\":\"%llu\",\"inode\":\"%llu\",\"byteLength\":\"%llu\"}",comma?",":"",suffixes[k],(unsigned long long)f->st_dev,(unsigned long long)f->st_ino,(unsigned long long)f->st_size);comma=1;}printf("]}");}puts("]}");return !ferror(stdout);}
static int check_scope(int i){struct database_scope *s=&scopes[i];int fd=directory(s->path);if(fd<0)return 0;struct stat st;int okay=!fstat(fd,&st)&&st.st_dev==s->device&&st.st_ino==s->inode;close(fd);if(!okay||!s->db||sqlite3_get_autocommit(s->db)||sqlite3_txn_state(s->db,"main")!=SQLITE_TXN_WRITE)return 0;
 for(int k=0;k<4;k++){struct file_identity *f=&s->files[k];if(metadata(i,k,&st)&&!(errno==ENOENT&&!f->exists&&!invalid))return 0;if(f->fd>=0&&(fstat(f->fd,&st)||st.st_dev!=f->device||st.st_ino!=f->inode))return 0;}return s->files[0].fd>=0&&!invalid;
}
#ifndef XIAOK_SQLITE_ENTRY
#define XIAOK_SQLITE_ENTRY main
#endif
int XIAOK_SQLITE_ENTRY(int argc,char **argv){
 unsigned long long uid;if(argc<11||(argc-2)%9||(argc-2)/9>DBS||!number(argv[1],&uid)||!uid||getuid()==0||getuid()!=geteuid()||(unsigned long long)getuid()!=uid)return 77;
 int result=65,opened=0;count=(argc-2)/9;
 for(int i=0;i<count;i++){struct database_scope*s=&scopes[i];char **a=argv+2+i*9;unsigned long long dev,ino,dbdev,dbino;s->path=a[0];s->name=a[3];if(!number(a[1],&dev)||!number(a[2],&ino)||!ino||!number(a[4],&dbdev)||!number(a[5],&dbino)||!dbino||!*s->name||strchr(s->name,'/')||!strcmp(s->name,".")||!strcmp(s->name,"..")||strlen(s->name)+8>NAME_MAX)goto end;
  s->directory=directory(s->path);if(s->directory<0)goto end;opened++;struct stat st;if(fstat(s->directory,&st)||(unsigned long long)st.st_dev!=dev||(unsigned long long)st.st_ino!=ino)goto end;s->device=st.st_dev;s->inode=st.st_ino;int n=snprintf(s->full,sizeof(s->full),"%s/%s",s->path,s->name);if(n<0||(size_t)n>=sizeof(s->full))goto end;
  s->files[0]=(struct file_identity){1,(dev_t)dbdev,(ino_t)dbino,-1};for(int k=1;k<4;k++)if(!parse_identity(a[5+k],&s->files[k]))goto end;
  for(int k=0;k<4;k++){if(metadata(i,k,&st)){if(!(errno==ENOENT&&!s->files[k].exists&&!invalid))goto end;}else if(k==1&&st.st_size>0)goto end;}
  for(int j=0;j<i;j++){if(scopes[j].files[0].device==s->files[0].device&&scopes[j].files[0].inode==s->files[0].inode)goto end;for(int a=0;a<4;a++)for(int b=0;b<4;b++){char one[PATH_MAX],two[PATH_MAX];snprintf(one,sizeof(one),"%s%s",s->full,suffixes[a]);snprintf(two,sizeof(two),"%s%s",scopes[j].full,suffixes[b]);if(!strcmp(one,two))goto end;}}
 }
 if(!install_hooks()){
#ifdef XIAOK_CUSTODY_TRACE
 fprintf(stderr,"hooks failed\n");
#endif
 goto end;}
 for(int i=0;i<count;i++){struct database_scope*s=&scopes[i];if(sqlite3_open_v2(s->full,&s->db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_NOFOLLOW,guarded.zName)!=SQLITE_OK)goto end;if(sqlite3_busy_timeout(s->db,0)!=SQLITE_OK||sqlite3_db_config(s->db,SQLITE_DBCONFIG_DEFENSIVE,1,NULL)!=SQLITE_OK||sqlite3_db_config(s->db,SQLITE_DBCONFIG_TRUSTED_SCHEMA,0,NULL)!=SQLITE_OK)goto end;if(sqlite3_exec(s->db,"PRAGMA temp_store=MEMORY;PRAGMA mmap_size=0;BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK||invalid)goto end;if(!pragma_integer(s->db,"PRAGMA page_size",&s->page_size)||!pragma_integer(s->db,"PRAGMA page_count",&s->page_count)||s->page_size<512||s->page_size>65536||(s->page_size&(s->page_size-1))||(sqlite3_int64)s->page_size*s->page_count>128LL*1024*1024)goto end;}
 holding=1;setvbuf(stdout,NULL,_IONBF,0);char nonce[37];random_uuid(nonce);int capture_index=0,capture_page=1,complete=0;
 for(int i=0;i<count;i++)if(!check_scope(i))goto end;if(!held_output(nonce))goto end;
 for(;;){char line[16];int received=command(line);if(received==0){result=0;goto end;}if(received<0)goto end;if(!strcmp(line,"RELEASE\n")){result=0;goto end;}
  for(int i=0;i<count;i++)if(!check_scope(i))goto end;
  if(!strcmp(line,"CHECK\n")){if(!held_output(nonce))goto end;continue;}
  if(strcmp(line,"PAGE\n")||complete)goto end;
  if(capture_index==count){complete=1;printf("{\"state\":\"snapshot-complete\",\"nonce\":\"%s\",\"count\":%d}\n",nonce,count);continue;}
  if(!page_output(capture_index,capture_page,nonce))goto end;
  for(int i=0;i<count;i++)if(!check_scope(i))goto end;
  capture_page++;if(capture_page>scopes[capture_index].page_count){capture_index++;capture_page=1;}
 }

 end:
#ifdef XIAOK_CUSTODY_TRACE
 for(int i=0;i<count;i++)if(scopes[i].db)fprintf(stderr,"result %d invalid %d sqlite %s\n",result,invalid,sqlite3_errmsg(scopes[i].db));
#endif
 holding=0;for(int i=count-1;i>=0;i--)if(scopes[i].db){if(!sqlite3_get_autocommit(scopes[i].db)&&sqlite3_exec(scopes[i].db,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK)result=65;if(sqlite3_close(scopes[i].db)!=SQLITE_OK)result=65;}for(int i=0;i<opened;i++)close(scopes[i].directory);return result;
}
