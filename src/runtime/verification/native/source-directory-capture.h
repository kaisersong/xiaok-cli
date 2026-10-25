/* Fixed namespace capture under the original ordinary-UID directory holder.
 * Entries classified as references still require independent all-kind custody. */
#include <dirent.h>
#define DC_LIMIT (128u*1024u*1024u)
static size_t dc_metadata_limit=DC_LIMIT;static int dc_budget_set;
struct dc_entry {int source,parent,reference;char *path,*name;struct stat before;};
struct dc_dir {int fd;struct stat before;};
static struct dc_entry *dc_entries;static size_t dc_count,dc_memory,dc_body_bytes,dc_next_entry,dc_offset;static struct dc_dir *dc_dirs;static size_t dc_dir_count;static int dc_started,dc_done,dc_file=-1;
static int dc_utf8(const unsigned char *s){while(*s){uint32_t value;unsigned n;unsigned char c=*s++;if(c<0x80){if(c<0x20||c==0x7f)return 0;continue;}if(c>=0xc2&&c<=0xdf){value=c&31;n=1;}else if(c>=0xe0&&c<=0xef){value=c&15;n=2;}else if(c>=0xf0&&c<=0xf4){value=c&7;n=3;}else return 0;unsigned original=n;while(n--){c=*s++;if((c&0xc0)!=0x80)return 0;value=(value<<6)|(c&63);}if((original==1&&value<0x80)||(original==2&&value<0x800)||(original==3&&value<0x10000)||value>0x10ffff||(value>=0xd800&&value<=0xdfff))return 0;}return 1;}
struct dc_reference {int source;char *path;dev_t device;ino_t inode;};
static struct dc_reference *dc_references;static size_t dc_reference_count;static int dc_references_sealed;
static int dc_reference_add(const char *line,int count,const char *nonce){
 if(!dc_budget_set||dc_started||dc_references_sealed)return 0;unsigned source;char hex[8192],device[21],inode[21],extra;int end=0;
 if(sscanf(line,"REFERENCE %u %8191s %20s %20s%n%c",&source,hex,device,inode,&end,&extra)!=5||extra!='\n'||line[end+1]||source>=(unsigned)count)return 0;
 unsigned long long d,i;if(!number(device,&d)||!number(inode,&i)||!i||(uint64_t)(dev_t)d!=d||(uint64_t)(ino_t)i!=i)return 0;
 size_t length=strlen(hex);if(!length||length%2||length/2>=PATH_MAX)return 0;char path[PATH_MAX];for(size_t n=0;n<length;n+=2){unsigned value=0;for(size_t k=0;k<2;k++){char c=hex[n+k];if(c>='0'&&c<='9')value=value*16+(unsigned)(c-'0');else if(c>='a'&&c<='f')value=value*16+(unsigned)(c-'a'+10);else return 0;}if(!value)return 0;path[n/2]=(char)value;}path[length/2]=0;
 if(path[0]=='/'||!dc_utf8((const unsigned char*)path))return 0;const char *part=path;for(;;){const char *slash=strchr(part,'/');size_t n=slash?(size_t)(slash-part):strlen(part);if(!n||(n==1&&part[0]=='.')||(n==2&&part[0]=='.'&&part[1]=='.'))return 0;if(!slash)break;part=slash+1;}
 for(size_t n=0;n<dc_reference_count;n++)if(dc_references[n].source==(int)source&&!strcmp(dc_references[n].path,path))return 0;
 size_t need=sizeof(struct dc_reference)+strlen(path)+1;if(need>dc_metadata_limit-dc_memory)return 0;struct dc_reference *next=realloc(dc_references,(dc_reference_count+1)*sizeof(*next));if(!next)return 0;dc_references=next;char *copy=strdup(path);if(!copy)return 0;dc_references[dc_reference_count++]=(struct dc_reference){(int)source,copy,(dev_t)d,(ino_t)i};dc_memory+=need;
 printf("{\"state\":\"reference\",\"nonce\":\"%s\"}\n",nonce);return 1;
}
static int dc_reference_kind(int source,const char *path,const struct stat *stat){int prefix=0;for(size_t n=0;n<dc_reference_count;n++){struct dc_reference *r=&dc_references[n];if(r->source!=source)continue;if(!strcmp(r->path,path))return S_ISDIR(stat->st_mode)&&stat->st_dev==r->device&&stat->st_ino==r->inode?3:-1;size_t length=strlen(path);if(!strncmp(r->path,path,length)&&r->path[length]=='/')prefix=1;}return prefix?(S_ISDIR(stat->st_mode)?2:-1):0;}
static int dc_same(const struct stat *a,const struct stat *b){if(a->st_dev!=b->st_dev||a->st_ino!=b->st_ino||a->st_mode!=b->st_mode||a->st_uid!=b->st_uid||a->st_nlink!=b->st_nlink||a->st_size!=b->st_size)return 0;
#ifdef __APPLE__
 return a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec&&a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec&&a->st_ctimespec.tv_sec==b->st_ctimespec.tv_sec&&a->st_ctimespec.tv_nsec==b->st_ctimespec.tv_nsec;
#else
 return a->st_mtim.tv_sec==b->st_mtim.tv_sec&&a->st_mtim.tv_nsec==b->st_mtim.tv_nsec&&a->st_ctim.tv_sec==b->st_ctim.tv_sec&&a->st_ctim.tv_nsec==b->st_ctim.tv_nsec;
#endif
}
static int dc_suffix(const char *name,const char *suffix){size_t a=strlen(name),b=strlen(suffix);return a>b&&!strcmp(name+a-b,suffix);}
static int dc_sqlite_suffix(const char *rest){return !strcmp(rest,".sqlite")||!strcmp(rest,".sqlite-journal")||!strcmp(rest,".sqlite-wal")||!strcmp(rest,".sqlite-shm");}
static int dc_sqlite(const char *name){if(strlen(name)<64)return 0;for(int i=0;i<64;i++)if(!((name[i]>='a'&&name[i]<='f')||(name[i]>='0'&&name[i]<='9')))return 0;return dc_sqlite_suffix(name+64);}
static int dc_alias_marker(const char *name){if(strlen(name)!=69||strcmp(name+64,".json"))return 0;for(int i=0;i<64;i++)if(!((name[i]>='a'&&name[i]<='f')||(name[i]>='0'&&name[i]<='9')))return 0;return 1;}
static int dc_native_goal(const char *name){if(strlen(name)!=64+strlen(".native-goal.json")||strcmp(name+64,".native-goal.json"))return 0;for(int i=0;i<64;i++)if(!((name[i]>='a'&&name[i]<='f')||(name[i]>='0'&&name[i]<='9')))return 0;return 1;}
static int dc_cleanup(struct held*h,const char*name){if(!strcmp(h->name,".goal-store.save.lock")){const char*prefix=".goal-native.save.lock.cleanup";size_t length=strlen(prefix);if(!strncmp(name,prefix,length))return dc_sqlite_suffix(name+length);}
 size_t n=strlen(h->name);if(!strncmp(name,h->name,n)&&!strncmp(name+n,".cleanup",8))return dc_sqlite_suffix(name+n+8);if(strcmp(h->name,".session-store-lock"))return 0;const char*p=name;size_t size=0;while((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='_'||*p=='-'){p++;size++;}return size>0&&size<=160&&!strncmp(p,".json.save-lock.cleanup",sizeof(".json.save-lock.cleanup")-1)&&dc_sqlite_suffix(p+sizeof(".json.save-lock.cleanup")-1);}
/* 0 unknown, 1 body, 2 recurse, 3 independent source reference. */
static int dc_kind(struct held *h,const char *prefix,const char *name,int dir){
 if(!*h->name)return !*prefix&&!dir&&dc_alias_marker(name)?1:0;
 if(*prefix){if(!strcmp(prefix,".session-execution"))return !dir&&dc_sqlite(name)?3:0;if(!strcmp(prefix,"snapshots"))return !dir&&(dc_suffix(name,".json")||dc_suffix(name,".journal.jsonl"))?1:0;return (!strcmp(prefix,".migrations")||!strcmp(prefix,".deletions"))&&!dir&&dc_suffix(name,".json")?1:0;}
 if(!dir&&dc_cleanup(h,name))return 3;
 if(!dir&&!strcmp(h->name,".goal-store.save.lock")&&!strncmp(name,"goals",5)&&dc_sqlite_suffix(name+5))return 3;
 if(!strcmp(h->name,".profile-source-registry.lock"))return !dir&&!strcmp(name,"registry.json")?1:0;
 if(!strcmp(h->name,".goal-store.save.lock"))return !dir&&(dc_suffix(name,".goal.json")||dc_native_goal(name))?1:0;
 if(!strcmp(h->name,".session-store-lock")){if(dir)return !strcmp(name,".migrations")||!strcmp(name,".deletions")||!strcmp(name,".session-execution")?2:0;return !strcmp(name,"last_session")||!strcmp(name,".session-aliases.json")||!strcmp(name,".session-aliases-enabled")||(name[0]!='.'&&dc_suffix(name,".json"))?1:0;}
 if(!strcmp(h->name,".task-store.save.lock")){if(dir){if(!strcmp(name,"protected-observation-sessions")||!strcmp(name,".canonical-session-aliases"))return 3;return !strcmp(name,"snapshots")?2:0;}return !strcmp(name,"active-task.json")?1:0;}return 0;
}
static int dc_scan(struct held *h,int source,int fd,const char *prefix){
 struct stat before;if(fstat(fd,&before)||!S_ISDIR(before.st_mode)||before.st_uid!=getuid())return 0;
 if(sizeof(struct dc_dir)>dc_metadata_limit||dc_memory>dc_metadata_limit-sizeof(struct dc_dir))return 0;struct dc_dir *dirs=realloc(dc_dirs,(dc_dir_count+1)*sizeof(*dirs));if(!dirs)return 0;dc_dirs=dirs;dc_memory+=sizeof(*dirs);int retained=fcntl(fd,F_DUPFD_CLOEXEC,3);if(retained<0)return 0;dc_dirs[dc_dir_count++]=(struct dc_dir){retained,before};
 int duplicate=fcntl(fd,F_DUPFD_CLOEXEC,3);if(duplicate<0)return 0;DIR *stream=fdopendir(duplicate);if(!stream){close(duplicate);return 0;}int okay=1;struct dirent *entry;
 errno=0;while((entry=readdir(stream))){const char *name=entry->d_name;if(!strcmp(name,".")||!strcmp(name,".."))continue;if(!*prefix&&(!strcmp(name,h->name)||sl_owned(h,name)))continue;if(!dc_utf8((const unsigned char*)name)){okay=0;break;}struct stat stat;if(fstatat(fd,name,&stat,AT_SYMLINK_NOFOLLOW)||stat.st_uid!=getuid()||(!S_ISREG(stat.st_mode)&&!S_ISDIR(stat.st_mode))||(S_ISREG(stat.st_mode)&&stat.st_nlink!=1)||stat.st_size<0){okay=0;break;}char path[PATH_MAX];int n=snprintf(path,sizeof(path),"%s%s%s",prefix,*prefix?"/":"",name);if(n<0||(size_t)n>=sizeof(path)){okay=0;break;}int original=dc_kind(h,prefix,name,S_ISDIR(stat.st_mode));int kind=dc_reference_kind(source,path,&stat);if(original==3&&S_ISDIR(stat.st_mode))kind=original;else if(!kind)kind=original;if(kind<=0){okay=0;break;}size_t need=sizeof(struct dc_entry)+strlen(path)+strlen(name)+2;if(need>dc_metadata_limit||dc_memory>dc_metadata_limit-need||(kind==1&&((uint64_t)stat.st_size>DC_LIMIT-dc_body_bytes))){okay=0;break;}struct dc_entry *entries=realloc(dc_entries,(dc_count+1)*sizeof(*entries));if(!entries){okay=0;break;}dc_entries=entries;char *p=strdup(path),*base=strdup(name);if(!p||!base){free(p);free(base);okay=0;break;}dc_entries[dc_count++]=(struct dc_entry){source,retained,kind==1?0:kind==2?1:2,p,base,stat};dc_memory+=need;if(kind==1)dc_body_bytes+=(size_t)stat.st_size;
 if(kind==2){int sub=openat(fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);struct stat opened;if(sub<0||fstat(sub,&opened)||!dc_same(&opened,&stat)||!dc_scan(h,source,sub,path)){if(sub>=0)close(sub);okay=0;break;}close(sub);}errno=0;}
 if(errno)okay=0;closedir(stream);struct stat after;return okay&&!fstat(fd,&after)&&dc_same(&before,&after);
}
static int dc_compare(const void *a,const void *b){const struct dc_entry *x=a,*y=b;if(x->source!=y->source)return x->source<y->source?-1:1;return strcmp(x->path,y->path);}
static int dc_current(void){for(size_t i=0;i<dc_dir_count;i++){struct stat now;if(fstat(dc_dirs[i].fd,&now)||!dc_same(&now,&dc_dirs[i].before))return 0;}for(size_t i=0;i<dc_count;i++){struct stat now;struct dc_entry *e=&dc_entries[i];if(fstatat(e->parent,e->name,&now,AT_SYMLINK_NOFOLLOW)||!dc_same(&now,&e->before))return 0;}return 1;}
static void dc_hex(const unsigned char *bytes,size_t n){for(size_t i=0;i<n;i++)printf("%02x",bytes[i]);}
static void dc_close(void){for(size_t i=0;i<dc_reference_count;i++)free(dc_references[i].path);free(dc_references);dc_references=NULL;dc_reference_count=0;if(dc_file>=0)close(dc_file);dc_file=-1;for(size_t i=0;i<dc_count;i++){free(dc_entries[i].path);free(dc_entries[i].name);}free(dc_entries);for(size_t i=0;i<dc_dir_count;i++)close(dc_dirs[i].fd);free(dc_dirs);dc_entries=NULL;dc_dirs=NULL;dc_count=dc_dir_count=0;}
static int dc_begin(struct held *sources,int count,const char *nonce){if(!dc_budget_set||dc_started)return 0;dc_references_sealed=1;dc_started=1;for(int i=0;i<count;i++)if(!dc_scan(&sources[i],i,sources[i].directory,""))return 0;if(dc_count)qsort(dc_entries,dc_count,sizeof(*dc_entries),dc_compare);if(!dc_current())return 0;printf("{\"state\":\"capture\",\"nonce\":\"%s\",\"entries\":%zu,\"metadataBytes\":%zu}\n",nonce,dc_count,dc_memory);return 1;}
static int dc_next(const char *nonce){if(!dc_started||dc_done||!dc_current())return 0;
 if(dc_file>=0){struct dc_entry *e=&dc_entries[dc_next_entry-1];if(dc_offset<(size_t)e->before.st_size){unsigned char bytes[65536];size_t want=(size_t)e->before.st_size-dc_offset;if(want>sizeof(bytes))want=sizeof(bytes);ssize_t got;do{got=read(dc_file,bytes,want);}while(got<0&&errno==EINTR);if(got<=0)return 0;struct stat now;if(fstat(dc_file,&now)||!dc_same(&now,&e->before)||!dc_current())return 0;printf("{\"state\":\"chunk\",\"nonce\":\"%s\",\"entryIndex\":%zu,\"offset\":%zu,\"bytes\":\"",nonce,dc_next_entry-1,dc_offset);dc_hex(bytes,(size_t)got);puts("\"}");dc_offset+=(size_t)got;return 1;}struct stat now;if(fstat(dc_file,&now)||!dc_same(&now,&e->before))return 0;close(dc_file);dc_file=-1;}
 if(dc_next_entry==dc_count){if(!dc_current())return 0;dc_done=1;printf("{\"state\":\"capture-complete\",\"nonce\":\"%s\",\"entries\":%zu}\n",nonce,dc_count);return 1;}
 struct dc_entry *e=&dc_entries[dc_next_entry];if(!e->reference){dc_file=openat(e->parent,e->name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);struct stat now;if(dc_file<0||fstat(dc_file,&now)||!dc_same(&now,&e->before))return 0;dc_offset=0;}
 printf("{\"state\":\"entry\",\"nonce\":\"%s\",\"sourceIndex\":%d,\"entryIndex\":%zu,\"kind\":\"%s\",\"pathHex\":\"",nonce,e->source,dc_next_entry,e->reference==2?"source-reference":e->reference?"directory":"file");dc_hex((const unsigned char*)e->path,strlen(e->path));printf("\",\"size\":%llu,\"physicalSize\":\"%llu\",\"device\":\"%llu\",\"inode\":\"%llu\",\"mode\":%u}\n",e->reference?0ull:(unsigned long long)e->before.st_size,(unsigned long long)e->before.st_size,(unsigned long long)e->before.st_dev,(unsigned long long)e->before.st_ino,(unsigned)e->before.st_mode);dc_next_entry++;return 1;
}
