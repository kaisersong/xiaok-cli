/* Test-only SDK boundary injection; include unchanged actual production C body. */
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include <wchar.h>
static int scenario, opens, closes, outstanding, known_reads, drive_reads;
static int registry_opens, registry_closes, registry_outstanding, com_init, com_uninit;
static int task_allocs, task_frees, heap_allocs, heap_frees, violations, heap_attempts;
static int known_parent_opens, handle_rebound[256], handle_checks[256], file_live[256], reg_live[256], reg_kind[256];
static int fail_alloc, fail_info, fail_open, info_attempts, open_attempts, injected_failure;
static int registry_attempts, registry_queries, observation_phase, target_probes, registry_probes;
static int file_initial[256], reg_observation[256];
static void held_ancestors(void);
static DWORD last_error;
static char answer[256];
static const wchar_t *known_path;
static wchar_t handle_paths[256][256];
static void *task_memory[128], *heap_memory[128];
static void fault_if(int v){if(v)violations++;}
HRESULT WINAPI test_known(REFKNOWNFOLDERID id,DWORD flags,HANDLE token,PWSTR *out){
 const GUID expected={0x62ab5d82,0xfdc1,0x4dc3,{0xa9,0xdd,0x07,0x0d,0x1d,0x49,0x5d,0x97}};
 fault_if(memcmp(id,&expected,sizeof(expected))!=0||flags!=0||token!=NULL);
 known_reads++;*out=NULL;
 if(known_reads>1){fault_if(observation_phase!=4);held_ancestors();}
 if(scenario==18||(scenario==19&&known_reads>1))return E_FAIL;
 const wchar_t *value=scenario==24&&known_reads>1?L"C:\\Changed\\ProgramData":known_path;
 *out=(PWSTR)CoTaskMemAlloc((wcslen(value)+1)*sizeof(wchar_t));
 if(!*out)return E_OUTOFMEMORY;
 task_memory[task_allocs++]=*out;wcscpy(*out,value);return S_OK;
}
void WINAPI test_task_free(LPVOID ptr){
 int found=0;for(int i=0;i<task_allocs;i++)if(task_memory[i]==ptr){task_memory[i]=NULL;found=1;break;}
 fault_if(!found);task_frees++;CoTaskMemFree(ptr);
}
void *test_calloc(size_t count,size_t size){
 heap_attempts++;if((scenario==20&&heap_attempts==1)||(fail_alloc&&heap_attempts==fail_alloc)){injected_failure=1;return NULL;}
 void *ptr=calloc(count,size);if(ptr){if(heap_allocs>=128)abort();heap_memory[heap_allocs++]=ptr;}return ptr;
}
void test_free(void *ptr){
 if(!ptr)return;
 int found=0;for(int i=0;i<heap_allocs;i++)if(heap_memory[i]==ptr){heap_memory[i]=NULL;found=1;break;}
 fault_if(!found);heap_frees++;free(ptr);
}
static void held_ancestors(void){
 const wchar_t *paths[]={L"C:\\",L"C:\\Parent",L"C:\\Parent\\ProgramData"};
 for(int p=0;p<3;p++){int live=0;for(int i=1;i<=opens;i++)if(file_live[i]&&file_initial[i]&&wcscmp(handle_paths[i],paths[p])==0)live++;fault_if(live==0);}
}
HANDLE WINAPI test_open(LPCWSTR path,DWORD access,DWORD share,LPSECURITY_ATTRIBUTES security,DWORD creation,DWORD flags,HANDLE template_file){
 int target=wcsstr(path,L"xiaok-verification")!=NULL;
 open_attempts++;if(target){fault_if(observation_phase!=0&&observation_phase!=2);observation_phase++;target_probes++;held_ancestors();}
 else if(observation_phase!=0){fault_if(observation_phase!=4);held_ancestors();}
 if(fail_open&&open_attempts==fail_open){injected_failure=1;last_error=ERROR_ACCESS_DENIED;return INVALID_HANDLE_VALUE;}
 fault_if(access!=(target?FILE_READ_ATTRIBUTES:(FILE_LIST_DIRECTORY|FILE_READ_ATTRIBUTES))||security!=NULL||creation!=OPEN_EXISTING||template_file!=NULL||!(flags&FILE_FLAG_OPEN_REPARSE_POINT)||!(flags&FILE_FLAG_BACKUP_SEMANTICS));
 if(!target)fault_if(share!=(FILE_SHARE_READ|FILE_SHARE_WRITE));
 if(target){
  if(scenario==8){last_error=ERROR_ACCESS_DENIED;return INVALID_HANDLE_VALUE;}
  if(scenario==9){last_error=ERROR_PATH_NOT_FOUND;return INVALID_HANDLE_VALUE;}
  if(!(scenario==10||(scenario==50&&target_probes==2)||(scenario==52&&target_probes==1))){last_error=ERROR_FILE_NOT_FOUND;return INVALID_HANDLE_VALUE;}
 }else if(scenario==23){last_error=ERROR_ACCESS_DENIED;return INVALID_HANDLE_VALUE;}
 opens++;outstanding++;file_initial[opens]=!target&&observation_phase==0;if(opens>=256||wcslen(path)>=256)abort();file_live[opens]=1;wcscpy(handle_paths[opens],path);
 if(wcscmp(path,L"C:\\Parent\\ProgramData")==0&&++known_parent_opens>1)handle_rebound[opens]=1;
 return (HANDLE)(uintptr_t)opens;
}
BOOL WINAPI test_information(HANDLE handle,LPBY_HANDLE_FILE_INFORMATION out){
 int id=(int)(uintptr_t)handle;if(id<=0||id>opens||!file_live[id])abort();
 if(!file_initial[id]||handle_checks[id]>0){fault_if(observation_phase!=4);held_ancestors();}
 info_attempts++;if(scenario==22||(fail_info&&info_attempts==fail_info)){injected_failure=1;return FALSE;}
 memset(out,0,sizeof(*out));handle_checks[id]++;out->dwFileAttributes=FILE_ATTRIBUTE_DIRECTORY;out->dwVolumeSerialNumber=7;
 for(const wchar_t *p=handle_paths[id];*p;p++)out->nFileIndexLow=out->nFileIndexLow*31+(DWORD)*p;
 if(scenario==5&&wcscmp(handle_paths[id],L"C:\\Parent")==0)out->dwFileAttributes|=FILE_ATTRIBUTE_REPARSE_POINT;
 if(scenario==6&&handle_checks[id]>1)out->nFileIndexLow++;
 if(scenario==7&&handle_rebound[id])out->nFileIndexLow++;
 return TRUE;
}
BOOL WINAPI test_close(HANDLE handle){int id=(int)(uintptr_t)handle;if(id<=0||id>opens)abort();fault_if(!file_live[id]);file_live[id]=0;closes++;outstanding--;return TRUE;}
DWORD WINAPI test_error(void){return last_error;}
UINT WINAPI test_drive(LPCWSTR path){fault_if(wcscmp(path,L"C:\\")!=0);drive_reads++;if(drive_reads>1){fault_if(observation_phase!=4);held_ancestors();}return scenario==4||(scenario==25&&drive_reads>1)?DRIVE_REMOTE:DRIVE_FIXED;}
LSTATUS WINAPI test_reg_open(HKEY parent,LPCWSTR path,DWORD options,REGSAM access,PHKEY out){
 registry_attempts++;
 int kind=wcscmp(path,L"SOFTWARE")==0?1:wcscmp(path,L"Xiaok")==0?2:3;
 int combined=wcscmp(path,L"Xiaok\\Verification")==0;
 if(kind==1){fault_if(observation_phase!=1&&observation_phase!=3);observation_phase++;registry_probes++;}
 int changing_present=(scenario==51&&registry_probes==2)||(scenario==53&&registry_probes==1);
 fault_if(options!=REG_OPTION_OPEN_LINK||access!=(KEY_READ|KEY_WOW64_64KEY)||combined||(!combined&&kind==3&&wcscmp(path,L"Verification")!=0));
 held_ancestors();
 if(kind==1)fault_if(parent!=HKEY_LOCAL_MACHINE);
 else {int key=(int)(uintptr_t)parent;fault_if(key<1000||key>=1256||!reg_live[key-1000]||reg_kind[key-1000]!=(kind==2||combined?1:2));}
 *out=NULL;
 if((kind==1&&scenario==15)||(kind==2&&scenario==16)||(kind==3&&scenario==17))return ERROR_ACCESS_DENIED;
 if(kind==2&&scenario!=12&&scenario!=13&&scenario!=17&&scenario!=49&&!changing_present)return ERROR_FILE_NOT_FOUND;
 if(kind==3&&scenario!=13&&scenario!=49&&!changing_present)return ERROR_FILE_NOT_FOUND;
 registry_opens++;registry_outstanding++;if(registry_opens>=256)abort();reg_live[registry_opens]=1;reg_kind[registry_opens]=kind;reg_observation[registry_opens]=registry_probes;
 *out=(HKEY)(uintptr_t)(1000+registry_opens);return ERROR_SUCCESS;
}
LSTATUS WINAPI test_reg_query(HKEY key,LPCWSTR name,LPDWORD reserved,LPDWORD type,LPBYTE data,LPDWORD bytes){
 registry_queries++;
 int id=(int)(uintptr_t)key-1000;if(id<=0||id>=256||!reg_live[id])abort();
 fault_if(observation_phase!=reg_observation[id]*2);
 fault_if(wcscmp(name,L"SymbolicLinkValue")!=0||reserved!=NULL);(void)data;(void)bytes;
 if(scenario==14)return ERROR_ACCESS_DENIED;
 if((scenario==11&&reg_kind[id]==1)||(scenario==12&&reg_kind[id]==2)||(scenario==13&&reg_kind[id]==3)){*type=REG_LINK;return ERROR_SUCCESS;}
 return ERROR_FILE_NOT_FOUND;
}
LSTATUS WINAPI test_reg_close(HKEY key){int id=(int)(uintptr_t)key-1000;if(id<=0||id>=256)abort();fault_if(!reg_live[id]);reg_live[id]=0;registry_closes++;registry_outstanding--;return ERROR_SUCCESS;}
DWORD WINAPI test_attributes(LPCWSTR path){fault_if(wcsstr(path,L"xiaok-verification")==NULL);if(scenario==10)return FILE_ATTRIBUTE_NORMAL;last_error=scenario==8?ERROR_ACCESS_DENIED:scenario==9?ERROR_PATH_NOT_FOUND:ERROR_FILE_NOT_FOUND;return INVALID_FILE_ATTRIBUTES;}
HRESULT WINAPI test_com(LPVOID reserved,DWORD model){fault_if(reserved!=NULL||model!=COINIT_APARTMENTTHREADED);com_init++;return scenario==21?E_FAIL:S_OK;}
void WINAPI test_uninit(void){com_uninit++;fault_if(com_init!=1||scenario==21);}
int test_printf(const char *format,...){va_list a;va_start(a,format);int n=vsnprintf(answer,sizeof(answer),format,a);va_end(a);return n;}
int test_puts(const char *value){snprintf(answer,sizeof(answer),"%s",value);return 0;}
#define SHGetKnownFolderPath test_known
#define CoTaskMemFree test_task_free
#define calloc test_calloc
#define free test_free
#define CreateFileW test_open
#define GetFileInformationByHandle test_information
#define CloseHandle test_close
#define GetLastError test_error
#define GetDriveTypeW test_drive
#define GetFileAttributesW test_attributes
#define RegOpenKeyExW test_reg_open
#define RegQueryValueExW test_reg_query
#define RegCloseKey test_reg_close
#define CoInitializeEx test_com
#define CoUninitialize test_uninit
#define printf test_printf
#define puts test_puts
#define main real_absence_main
#define wmain real_absence_wmain
#include XIAOK_ABSENCE_TEST_SOURCE
#undef main
#undef wmain
#undef printf
#undef puts
int main(void){
 int failed=0;
 const wchar_t *paths[]={L"C:\\Parent\\ProgramData",L"C:\\Parent\\.\\ProgramData",L"C:\\Parent\\..\\ProgramData",L"C:\\Parent\\\\ProgramData"};
 const char *names[]={"plain-absent","dot","dot-dot","empty-segment","remote-drive","ancestor-reparse","held-identity-change","pathname-rebound","target-access-denied","target-parent-missing","target-present","software-link","xiaok-link","verification-link","registry-query-denied","software-open-denied","xiaok-open-denied","verification-open-denied","known-first-failure","known-second-failure","allocation-failure","COM-failure","information-failure","ancestor-open-denied","known-path-changed","drive-changed","forward-slash","extra-colon","trailing-empty"};
 for(scenario=0;scenario<54;scenario++){
  fail_alloc=scenario>=29&&scenario<32?scenario-28:0;fail_info=scenario>=32&&scenario<41?scenario-31:0;fail_open=scenario>=41&&scenario<49?scenario-40:0;info_attempts=open_attempts=injected_failure=0;
  known_path=scenario<=3?paths[scenario]:scenario==26?L"C:\\Parent/ProgramData":scenario==27?L"C:\\Parent:stream\\ProgramData":scenario==28?L"C:\\Parent\\ProgramData\\":paths[0];
  registry_attempts=registry_queries=observation_phase=target_probes=registry_probes=0;
  opens=closes=outstanding=known_reads=drive_reads=registry_opens=registry_closes=registry_outstanding=com_init=com_uninit=task_allocs=task_frees=heap_allocs=heap_frees=violations=heap_attempts=known_parent_opens=0;
  memset(reg_observation,0,sizeof(reg_observation));memset(file_initial,0,sizeof(file_initial));memset(handle_checks,0,sizeof(handle_checks));memset(handle_rebound,0,sizeof(handle_rebound));memset(file_live,0,sizeof(file_live));memset(reg_live,0,sizeof(reg_live));memset(task_memory,0,sizeof(task_memory));memset(heap_memory,0,sizeof(heap_memory));answer[0]=0;
#ifdef XIAOK_ABSENCE_TEST_WMAIN
  int result=real_absence_wmain(1,NULL);
#else
  int result=real_absence_main(1,NULL);
#endif
  answer[strcspn(answer,"\r\n")]=0;
  fault_if(outstanding!=0||registry_outstanding!=0||task_allocs!=task_frees||heap_allocs!=heap_frees);
  fault_if(com_init!=1||com_uninit!=(scenario==21?0:1));
  if(scenario==0){
   fault_if(heap_attempts!=3||info_attempts!=9||open_attempts!=8||registry_attempts!=4||registry_queries!=2);
   fault_if(known_reads!=2||drive_reads!=2||known_parent_opens<2);
   const wchar_t *paths[]={L"C:\\",L"C:\\Parent",L"C:\\Parent\\ProgramData"};
   for(int p=0;p<3;p++){int opened=0,checked=0;for(int i=1;i<=opens;i++)if(wcscmp(handle_paths[i],paths[p])==0){opened++;checked+=handle_checks[i];}fault_if(opened<2||checked<3);}
  }
  if(scenario>=50)fault_if(observation_phase!=4||target_probes!=2||registry_probes!=2);
  if(scenario==13||scenario==49)fault_if(registry_attempts!=6||registry_queries!=4);
  if(scenario>=29&&scenario<49)fault_if(!injected_failure);
  char fault_name[64];if(scenario>=29)snprintf(fault_name,sizeof(fault_name),"%s-failure-%d",fail_alloc?"allocation":fail_info?"information":"open",fail_alloc?fail_alloc:fail_info?fail_info:fail_open);
  const char *changing_names[]={"directory-absent-then-present","registry-absent-then-present","directory-present-then-absent","registry-present-then-absent"};
  const char *case_name=scenario<29?names[scenario]:scenario==49?"verification-plain-present":scenario>=50?changing_names[scenario-50]:fault_name;
  const char *expected=scenario==0?"ordinary":scenario==10||scenario==13||scenario>=49?"installed":"unavailable";
  char exact[128];snprintf(exact,sizeof(exact),"{\"version\":1,\"kind\":\"%s\"}",expected);
  int passed=result==0&&violations==0&&strcmp(answer,exact)==0;
  fprintf(stdout,"{\"case\":\"%s\",\"passed\":%s,\"result\":%s,\"expectedKind\":\"%s\",\"boundaryViolations\":%d,\"fileOpened\":%d,\"fileClosed\":%d,\"registryOpened\":%d,\"registryClosed\":%d,\"taskAllocated\":%d,\"taskFreed\":%d,\"heapAllocated\":%d,\"heapFreed\":%d,\"COMInitialized\":%d,\"COMUninitialized\":%d,\"knownReads\":%d,\"driveReads\":%d}\n",case_name,passed?"true":"false",answer[0]?answer:"null",expected,violations,opens,closes,registry_opens,registry_closes,task_allocs,task_frees,heap_allocs,heap_frees,com_init,com_uninit,known_reads,drive_reads);
  if(!passed)failed=1;
 }
 return failed;
}
