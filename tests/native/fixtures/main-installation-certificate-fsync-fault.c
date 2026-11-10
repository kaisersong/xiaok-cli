#define _DARWIN_C_SOURCE
#include <unistd.h>
#include <errno.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <string.h>
#ifndef MI_INSTALLATION_CERT_COMPONENT_BUILD
#error CERTIFICATE_FAULT_CANNOT_BE_PRODUCTION
#endif
static int (*const original_fsync_sdk)(int)=fsync;
static int fixed_post_fsync_fault(int);
#define fsync fixed_post_fsync_fault
#define main original_certifier_main
#include "../../../native/main-installation/main-installation-certifier.c"
#undef main
#undef fsync
static int fixed_post_fsync_fault(int fd){
 int result=original_fsync_sdk(fd);static int fired;struct stat actual;char path[PATH_MAX];
 if(result||fired||fstat(fd,&actual)||!S_ISREG(actual.st_mode)||actual.st_size!=120||fcntl(fd,F_GETPATH,path)||!strstr(path,"/installation.bin.pending"))return result;
 fired=1;fputs("MI_COMPONENT_REAL_FSYNC_THEN_EIO\n",stderr);errno=EIO;return -1;
}
int main(int argc,char **argv){return original_certifier_main(argc,argv);}
