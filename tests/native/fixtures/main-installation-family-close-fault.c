#define _DARWIN_C_SOURCE
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
static int (*const original_close_sdk)(int)=close;
static int fixed_family_close_fault(int);
#define close fixed_family_close_fault
#define main original_helper_main
#include "../../../native/main-installation/main-installation-helper.c"
#undef main
#undef close
#ifndef MI_FIXTURE_BUILD
#error "Controlled close fault is fixture-only"
#endif
static int fixed_family_close_fault(int fd){
 char path[PATH_MAX];int target=fcntl(fd,F_GETPATH,path)==0&&strstr(path,"/authority-families/admission/")&&strstr(path,"/groups.sqlite")&&!strstr(path,"-journal");
 int result=original_close_sdk(fd);static int fired;if(result||fired||!target)return result;
 fired=1;fputs("MI_TEST_ORIGINAL_FAMILY_CLOSE_POSTCALL_FAULT\n",stderr);errno=EIO;return -1;
}
int main(int argc,char **argv){return original_helper_main(argc,argv);}
