#define _DARWIN_C_SOURCE
#include <unistd.h>
#include <errno.h>
#include <sys/stat.h>
#include <string.h>
static int (*const original_fsync_sdk)(int)=fsync;
static int fixed_claim_fsync_fault(int);
#define fsync fixed_claim_fsync_fault
#define main original_helper_main
#include "../../../native/main-installation/main-installation-helper.c"
#undef main
#undef fsync
#if !defined(MI_FIXTURE_BUILD)
#error "Fault fixture cannot be compiled into a production helper"
#endif
static int fixed_claim_fsync_fault(int fd){
 int result=original_fsync_sdk(fd);static int fired;if(result||fired)return result;
 struct stat value;unsigned char header[16];int target=0;
#if defined(MI_TEST_FAMILY_CLAIM_FAULT)
 char actual[PATH_MAX];target=fcntl(fd,F_GETPATH,actual)==0&&strstr(actual,"/authority-families/admission/")&&!fstat(fd,&value)&&S_ISREG(value.st_mode)&&value.st_size==1024&&pread(fd,header,16,512)==16&&!memcmp(header,"XMRCP002",8)&&header[15]==2;
#elif defined(MI_TEST_DELETE_INTENT_FAULT)
 target=!fstat(fd,&value)&&S_ISREG(value.st_mode)&&value.st_size>=512&&value.st_size%512==0&&pread(fd,header,16,value.st_size-512)==16&&!memcmp(header,"XMRCP002",8)&&header[15]==6;
#elif defined(MI_TEST_DELETE_DIRECTORY_FAULT)
 struct stat authority;if(!fstat(fd,&value)&&S_ISDIR(value.st_mode)&&!stat(MI_FIXED_ROOT "/authority",&authority)&&value.st_dev==authority.st_dev&&value.st_ino==authority.st_ino){
  int r=open(MI_FIXED_ROOT "/authority/birth.receipts",O_RDONLY|O_CLOEXEC);struct stat file,journal;int missing=lstat(MI_FIXED_ROOT "/authority/" MI_DATABASE_BASENAME "-journal",&journal)<0&&errno==ENOENT;
  target=r>=0&&missing&&!fstat(r,&file)&&file.st_size>=512&&pread(r,header,16,file.st_size-512)==16&&!memcmp(header,"XMRCP002",8)&&header[15]==6;if(r>=0&&close(r))return -1;
 }
#else
 target=!fstat(fd,&value)&&S_ISREG(value.st_mode)&&value.st_size==1024&&pread(fd,header,16,512)==16&&!memcmp(header,"XMRCP002",8)&&header[15]==2;
#endif
 if(target){fired=1;fputs("MI_TEST_DURABLE_FSYNC_POSTCALL_FAULT\n",stderr);errno=EIO;return -1;}return result;
}
int main(int argc,char **argv){return original_helper_main(argc,argv);}
