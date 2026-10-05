/* Fixed read-only kernel observation. Never a quiescence or execution receipt.
 * Repeated reads reduce drift but are not an atomic exec/incarnation proof. */
#include <libproc.h>
#include <sys/proc_info.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <errno.h>
#include <stdint.h>
static int metadata(int pid,struct proc_bsdinfo *value){memset(value,0,sizeof(*value));return proc_pidinfo(pid,PROC_PIDTBSDINFO,0,value,sizeof(*value))==(int)sizeof(*value)&&value->pbi_pid==(uint32_t)pid&&value->pbi_start_tvusec<1000000;}
static int equal(const struct proc_bsdinfo *a,const struct proc_bsdinfo *b){return a->pbi_pid==b->pbi_pid&&a->pbi_ppid==b->pbi_ppid&&a->pbi_uid==b->pbi_uid&&a->pbi_ruid==b->pbi_ruid&&a->pbi_start_tvsec==b->pbi_start_tvsec&&a->pbi_start_tvusec==b->pbi_start_tvusec;}
static void string(const char *value){putchar('"');for(const unsigned char *p=(const unsigned char *)value;*p;p++){if(*p=='"'||*p=='\\'){putchar('\\');putchar(*p);}else if(*p<32||*p>=127)printf("\\u%04x",*p);else putchar(*p);}putchar('"');}
int main(int argc,char **argv){
 if(argc!=2||!argv[1][0])return 64;for(const char *p=argv[1];*p;p++)if(*p<'0'||*p>'9')return 64;
 char *end=NULL;errno=0;unsigned long raw=strtoul(argv[1],&end,10);if(errno||!end||*end||!raw||raw>INT_MAX)return 64;int pid=(int)raw;
 struct proc_bsdinfo a,b,c;char first[PROC_PIDPATHINFO_MAXSIZE],second[PROC_PIDPATHINFO_MAXSIZE];
 if(!metadata(pid,&a)||proc_pidpath(pid,first,sizeof(first))<=0||!metadata(pid,&b)||proc_pidpath(pid,second,sizeof(second))<=0||!metadata(pid,&c))return 65;
 if(!equal(&a,&b)||!equal(&a,&c)||strcmp(first,second)||first[0]!='/')return 66;
 /* The installed QEMU path is ASCII and fixed by package identity. Refuse
  * undecodable/raw byte paths rather than misrepresent them in JSON. */
 for(const unsigned char *p=(const unsigned char *)first;*p;p++)if(*p<32||*p>=127)return 66;
 printf("{\"pid\":%u,\"parentPid\":%u,\"uid\":%u,\"realUid\":%u,\"startIdentity\":\"%llu:%llu\",\"executable\":",a.pbi_pid,a.pbi_ppid,a.pbi_uid,a.pbi_ruid,(unsigned long long)a.pbi_start_tvsec,(unsigned long long)a.pbi_start_tvusec);string(first);printf("}\n");return 0;
}
