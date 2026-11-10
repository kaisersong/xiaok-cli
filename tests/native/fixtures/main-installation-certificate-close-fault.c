#define _DARWIN_C_SOURCE
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#ifndef MI_INSTALLATION_CERT_COMPONENT_BUILD
#error CERTIFICATE_FAULT_CANNOT_BE_PRODUCTION
#endif
static int (*const original_close_sdk)(int)=close;
static int fixed_post_close_fault(int);
#define close fixed_post_close_fault
#define main original_certifier_main
#include "../../../native/main-installation/main-installation-certifier.c"
#undef main
#undef close
static int fixed_post_close_fault(int fd){
 char path[PATH_MAX];int target=fcntl(fd,F_GETPATH,path)==0&&strstr(path,"/installation.bin.pending");
#ifdef MI_CERTIFICATE_ANCESTOR_CLOSE
 target=fcntl(fd,F_GETPATH,path)==0&&strstr(path,"/mi-certificate-")&&!strstr(path,"/installed");
#endif
 int code=original_close_sdk(fd);static int fired;
 if(code||fired||!target)return code;fired=1;fputs("MI_COMPONENT_REAL_CLOSE_THEN_EIO\n",stderr);errno=EIO;return -1;
}
int main(int argc,char **argv){return original_certifier_main(argc,argv);}
