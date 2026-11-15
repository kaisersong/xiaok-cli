/* Ordinary owner metadata only. This module is not a DSH authority. */
#include <node_api.h>
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static napi_value fail(napi_env env) {
  napi_throw_error(env, NULL, "windows_security_unavailable"); return NULL;
}
static int set(napi_env env, napi_value object, const char *key, napi_value value) {
  return napi_set_named_property(env, object, key, value) == napi_ok;
}
static napi_value text(napi_env env, const char *value) {
  napi_value result; if(napi_create_string_utf8(env,value,NAPI_AUTO_LENGTH,&result)!=napi_ok)return NULL; return result;
}
static napi_value wide(napi_env env, const wchar_t *value) {
  int length=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value,-1,NULL,0,NULL,NULL);
  if(length<1)return NULL;
  char *bytes=(char*)calloc((size_t)length,1);if(!bytes)return NULL;
  if(!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value,-1,bytes,length,NULL,NULL)){free(bytes);return NULL;}
  napi_value result=text(env,bytes);free(bytes);return result;
}
static napi_value sid(napi_env env, PSID value) {
  LPWSTR string=NULL;if(!IsValidSid(value)||!ConvertSidToStringSidW(value,&string))return NULL;
  napi_value result=wide(env,string);LocalFree(string);return result;
}
static wchar_t *path_value(napi_env env,napi_value arg) {
  size_t length=0;napi_valuetype type;
  if(napi_typeof(env,arg,&type)!=napi_ok||type!=napi_string)return NULL;
  if(napi_get_value_string_utf16(env,arg,NULL,0,&length)!=napi_ok||length<3||length>32767)return NULL;
  wchar_t *path=(wchar_t*)calloc(length+1,sizeof(wchar_t));if(!path)return NULL;
  if(napi_get_value_string_utf16(env,arg,(char16_t*)path,length+1,&length)!=napi_ok||wcslen(path)!=length){free(path);return NULL;}
  if(!((length>3&&path[1]==L':'&&(path[2]==L'\\'||path[2]==L'/'))||(path[0]==L'\\'&&path[1]==L'\\'))){free(path);return NULL;}
  return path;
}
static wchar_t *argument_path(napi_env env,napi_callback_info info) {
  napi_value arg;size_t argc=1;
  if(napi_get_cb_info(env,info,&argc,&arg,NULL,NULL)!=napi_ok||argc!=1)return NULL;
  return path_value(env,arg);
}
static TOKEN_USER *current_user(void) {
  HANDLE token=NULL;DWORD length=0;TOKEN_USER *user=NULL;
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return NULL;
  GetTokenInformation(token,TokenUser,NULL,0,&length);
  if(length>0&&length<65536){user=(TOKEN_USER*)calloc(length,1);if(user&&!GetTokenInformation(token,TokenUser,user,length,&length)){free(user);user=NULL;}}
  if(!CloseHandle(token)){free(user);user=NULL;}return user;
}
static int protection_owner(PSID owner,TOKEN_USER *user) {
  if(EqualSid(owner,user->User.Sid))return 1;
  /* Elevated Windows tokens normally create Administrators-owned files. This
   * permits DACL tightening only, never legacy ownership/adoption evidence. */
  HANDLE token=NULL;TOKEN_ELEVATION elevation;DWORD size=0;TOKEN_OWNER *default_owner=NULL;int allowed=0;
  if(!IsWellKnownSid(owner,WinBuiltinAdministratorsSid)||!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return 0;
  if(!GetTokenInformation(token,TokenElevation,&elevation,sizeof(elevation),&size)||!elevation.TokenIsElevated)goto done;
  size=0;GetTokenInformation(token,TokenOwner,NULL,0,&size);
  if(size>0&&size<65536){default_owner=(TOKEN_OWNER*)calloc(size,1);if(default_owner&&GetTokenInformation(token,TokenOwner,default_owner,size,&size))allowed=EqualSid(owner,default_owner->Owner);}
done:free(default_owner);CloseHandle(token);return allowed;
}
static HANDLE open_path(const wchar_t *path, int write) {
  /* No FILE_SHARE_DELETE: replacement cannot change the opened object mid-call. */
  return CreateFileW(path,READ_CONTROL|FILE_READ_ATTRIBUTES|(write?WRITE_DAC:0),FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_BACKUP_SEMANTICS,NULL);
}
static int private_descriptor(PSECURITY_DESCRIPTOR descriptor,PSID owner,PACL acl,TOKEN_USER *user,BYTE flags) {
  SECURITY_DESCRIPTOR_CONTROL control;DWORD revision;void *raw=NULL;
  if(!descriptor||!owner||!protection_owner(owner,user)||!acl||!IsValidAcl(acl)||acl->AceCount!=1||!GetSecurityDescriptorControl(descriptor,&control,&revision)||(control&SE_DACL_PROTECTED)==0||!GetAce(acl,0,&raw))return 0;
  ACCESS_ALLOWED_ACE *ace=(ACCESS_ALLOWED_ACE*)raw;
  return ace->Header.AceType==ACCESS_ALLOWED_ACE_TYPE&&ace->Header.AceFlags==flags&&ace->Mask==FILE_ALL_ACCESS&&ace->Header.AceSize>=16&&GetSidLengthRequired(((SID*)&ace->SidStart)->SubAuthorityCount)<=(DWORD)ace->Header.AceSize-8&&IsValidSid(&ace->SidStart)&&EqualSid(&ace->SidStart,user->User.Sid);
}
static napi_value inspect_handle(napi_env env,HANDLE handle,TOKEN_USER *user,int require_file) {
  BY_HANDLE_FILE_INFORMATION file;PSECURITY_DESCRIPTOR descriptor=NULL;PSID owner=NULL;PACL acl=NULL;napi_value result=NULL;
  if(!GetFileInformationByHandle(handle,&file)||(file.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||(!(file.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)&&file.nNumberOfLinks!=1)||(require_file&&(file.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)))return NULL;
  if(GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,NULL,&acl,NULL,&descriptor)!=ERROR_SUCCESS||!descriptor||!owner||!acl)goto done;
  if(!IsValidAcl(acl))goto done;
  SECURITY_DESCRIPTOR_CONTROL control;DWORD revision;
  if(!GetSecurityDescriptorControl(descriptor,&control,&revision))goto done;
  napi_value allows,protected_value,directory_value,owner_eligible;
  if(napi_create_object(env,&result)!=napi_ok||napi_create_array(env,&allows)!=napi_ok)goto invalid;
  uint32_t allow_count=0;
  for(DWORD i=0;i<acl->AceCount;i++){
    void *raw=NULL;if(!GetAce(acl,i,&raw))goto invalid;ACE_HEADER *header=(ACE_HEADER*)raw;
    if(header->AceType==ACCESS_DENIED_ACE_TYPE)continue;
    if(header->AceType!=ACCESS_ALLOWED_ACE_TYPE||header->AceSize<sizeof(ACCESS_ALLOWED_ACE))goto invalid;
    ACCESS_ALLOWED_ACE *entry=(ACCESS_ALLOWED_ACE*)raw;PSID principal=(PSID)&entry->SidStart;
    if(header->AceSize<16||GetSidLengthRequired(((SID*)principal)->SubAuthorityCount)>(DWORD)header->AceSize-8||!IsValidSid(principal))goto invalid;
    napi_value name=sid(env,principal);if(!name||napi_set_element(env,allows,allow_count++,name)!=napi_ok)goto invalid;
  }
  LPWSTR sddl=NULL;
  if(!ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor,SDDL_REVISION_1,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&sddl,NULL))goto invalid;
  napi_value descriptor_text=wide(env,sddl);LocalFree(sddl);if(!descriptor_text)goto invalid;
  char identity[96];snprintf(identity,sizeof(identity),"%lu:%lu:%lu:%lu",(unsigned long)file.dwVolumeSerialNumber,(unsigned long)file.nFileIndexHigh,(unsigned long)file.nFileIndexLow,(unsigned long)file.nNumberOfLinks);
  napi_value owner_text=sid(env,owner),current_text=sid(env,user->User.Sid);
  if(!owner_text||!current_text||napi_get_boolean(env,(control&SE_DACL_PROTECTED)!=0,&protected_value)!=napi_ok||napi_get_boolean(env,(file.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=0,&directory_value)!=napi_ok||napi_get_boolean(env,protection_owner(owner,user),&owner_eligible)!=napi_ok)goto invalid;
  if(!set(env,result,"ownerSid",owner_text)||!set(env,result,"currentSid",current_text)||!set(env,result,"allowSids",allows)||!set(env,result,"protected",protected_value)||!set(env,result,"directory",directory_value)||!set(env,result,"protectionOwnerEligible",owner_eligible)||!set(env,result,"identity",text(env,identity))||!set(env,result,"sddl",descriptor_text))goto invalid;
  goto done;
invalid: result=NULL;
done: if(descriptor)LocalFree(descriptor);return result;
}
static napi_value inspect(napi_env env,napi_callback_info info) {
  wchar_t *path=argument_path(env,info);if(!path)return fail(env);
  TOKEN_USER *user=current_user();HANDLE handle=open_path(path,0);free(path);
  napi_value result=NULL;if(user&&handle!=INVALID_HANDLE_VALUE)result=inspect_handle(env,handle,user,0);
  if(handle!=INVALID_HANDLE_VALUE&&!CloseHandle(handle))result=NULL;free(user);return result?result:fail(env);
}
static napi_value protect_path(napi_env env,napi_callback_info info,int directory) {
  wchar_t *path=argument_path(env,info);if(!path)return fail(env);
  TOKEN_USER *user=current_user();HANDLE handle=open_path(path,1);free(path);
  PSECURITY_DESCRIPTOR descriptor=NULL;PSID owner=NULL;PACL acl=NULL,current_acl=NULL;napi_value result=NULL;
  BY_HANDLE_FILE_INFORMATION file;
  if(!user||handle==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(handle,&file)||(file.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||!!(file.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&file.nNumberOfLinks!=1))goto done;
  if(GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,NULL,&current_acl,NULL,&descriptor)!=ERROR_SUCCESS||!owner||!protection_owner(owner,user))goto done;
  if(private_descriptor(descriptor,owner,current_acl,user,directory?3:0)){result=inspect_handle(env,handle,user,!directory);goto done;}
  DWORD size=(DWORD)(sizeof(ACL)+sizeof(ACCESS_ALLOWED_ACE)-sizeof(DWORD)+GetLengthSid(user->User.Sid));
  acl=(PACL)calloc(size,1);if(!acl||!InitializeAcl(acl,size,ACL_REVISION)||!AddAccessAllowedAceEx(acl,ACL_REVISION,directory?3:0,FILE_ALL_ACCESS,user->User.Sid))goto done;
  if(SetSecurityInfo(handle,SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,NULL,NULL,acl,NULL)!=ERROR_SUCCESS)goto done;
  {
    PSECURITY_DESCRIPTOR after=NULL;PACL actual=NULL;PSID actual_owner=NULL;
    int verified=GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&actual_owner,NULL,&actual,NULL,&after)==ERROR_SUCCESS
      &&after&&actual_owner&&EqualSid(actual_owner,owner)&&private_descriptor(after,actual_owner,actual,user,directory?3:0);
    if(after)LocalFree(after);if(verified)result=inspect_handle(env,handle,user,!directory);
  }
done:
  free(acl);if(descriptor)LocalFree(descriptor);if(handle!=INVALID_HANDLE_VALUE&&!CloseHandle(handle))result=NULL;free(user);
  return result?result:fail(env);
}
static napi_value protect(napi_env env,napi_callback_info info){return protect_path(env,info,0);}
static napi_value protect_directory(napi_env env,napi_callback_info info){return protect_path(env,info,1);}
static napi_value create_directory(napi_env env,napi_callback_info info){
  wchar_t *path=argument_path(env,info);TOKEN_USER *user=current_user();PACL acl=NULL;napi_value result=NULL;
  if(!path||!user)goto done;
  DWORD size=(DWORD)(sizeof(ACL)+sizeof(ACCESS_ALLOWED_ACE)-sizeof(DWORD)+GetLengthSid(user->User.Sid));
  acl=(PACL)calloc(size,1);SECURITY_DESCRIPTOR descriptor;
  if(!acl||!InitializeAcl(acl,size,ACL_REVISION)||!AddAccessAllowedAceEx(acl,ACL_REVISION,3,FILE_ALL_ACCESS,user->User.Sid)||!InitializeSecurityDescriptor(&descriptor,SECURITY_DESCRIPTOR_REVISION)||!SetSecurityDescriptorOwner(&descriptor,user->User.Sid,FALSE)||!SetSecurityDescriptorDacl(&descriptor,TRUE,acl,FALSE)||!SetSecurityDescriptorControl(&descriptor,SE_DACL_PROTECTED,SE_DACL_PROTECTED))goto done;
  SECURITY_ATTRIBUTES attributes={sizeof(attributes),&descriptor,FALSE};
  if(CreateDirectoryW(path,&attributes)){napi_get_boolean(env,true,&result);}
  else if(GetLastError()==ERROR_ALREADY_EXISTS){napi_get_boolean(env,false,&result);}
done:free(path);free(user);free(acl);return result?result:fail(env);
}
static napi_value birth(napi_env env,napi_callback_info info) {
  napi_value arg;size_t argc=1;double pid=0;
  if(napi_get_cb_info(env,info,&argc,&arg,NULL,NULL)!=napi_ok||argc!=1||napi_get_value_double(env,arg,&pid)!=napi_ok||!(pid>=1&&pid<=4294967295.0)||pid!=(DWORD)pid)return fail(env);
  HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,(DWORD)pid);if(!process)return fail(env);
  FILETIME created,exited,kernel,user;
  int ok=GetProcessTimes(process,&created,&exited,&kernel,&user)&&WaitForSingleObject(process,0)==WAIT_TIMEOUT;if(!CloseHandle(process))ok=0;
  if(!ok)return fail(env);
  uint64_t ticks=(((uint64_t)created.dwHighDateTime<<32)|created.dwLowDateTime)+UINT64_C(504911232000000000);
  char output[32];snprintf(output,sizeof(output),"%llu",(unsigned long long)ticks);return text(env,output);
}
static napi_value write_private(napi_env env,napi_callback_info info) {
  napi_value args[3],result=NULL;size_t argc=3,length=0;bool exclusive=false;napi_valuetype type;
  if(napi_get_cb_info(env,info,&argc,args,NULL,NULL)!=napi_ok||argc!=3||napi_typeof(env,args[1],&type)!=napi_ok||type!=napi_string||napi_get_value_bool(env,args[2],&exclusive)!=napi_ok)return fail(env);
  wchar_t *path=path_value(env,args[0]);char *bytes=NULL;TOKEN_USER *user=NULL;PACL acl=NULL;HANDLE handle=INVALID_HANDLE_VALUE;
  if(!path||napi_get_value_string_utf8(env,args[1],NULL,0,&length)!=napi_ok||length>4*1024*1024)goto done;
  bytes=(char*)calloc(length+1,1);if(!bytes||napi_get_value_string_utf8(env,args[1],bytes,length+1,&length)!=napi_ok)goto done;
  user=current_user();if(!user)goto done;
  DWORD size=(DWORD)(sizeof(ACL)+sizeof(ACCESS_ALLOWED_ACE)-sizeof(DWORD)+GetLengthSid(user->User.Sid));
  acl=(PACL)calloc(size,1);SECURITY_DESCRIPTOR descriptor;
  if(!acl||!InitializeAcl(acl,size,ACL_REVISION)||!AddAccessAllowedAceEx(acl,ACL_REVISION,0,FILE_ALL_ACCESS,user->User.Sid)||!InitializeSecurityDescriptor(&descriptor,SECURITY_DESCRIPTOR_REVISION)||!SetSecurityDescriptorOwner(&descriptor,user->User.Sid,FALSE)||!SetSecurityDescriptorDacl(&descriptor,TRUE,acl,FALSE)||!SetSecurityDescriptorControl(&descriptor,SE_DACL_PROTECTED,SE_DACL_PROTECTED))goto done;
  SECURITY_ATTRIBUTES attributes={sizeof(attributes),&descriptor,FALSE};
  handle=CreateFileW(path,GENERIC_WRITE|READ_CONTROL,0,&attributes,exclusive?CREATE_NEW:OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,NULL);
  if(handle==INVALID_HANDLE_VALUE){DWORD error=GetLastError();if(exclusive&&(error==ERROR_FILE_EXISTS||error==ERROR_ALREADY_EXISTS))napi_get_boolean(env,false,&result);goto done;}
  BY_HANDLE_FILE_INFORMATION file;PSECURITY_DESCRIPTOR actual=NULL;PSID owner=NULL;PACL dacl=NULL;
  int verified=GetFileInformationByHandle(handle,&file)&&(file.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))==0&&file.nNumberOfLinks==1
    &&GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,NULL,&dacl,NULL,&actual)==ERROR_SUCCESS&&private_descriptor(actual,owner,dacl,user,0);
  if(actual)LocalFree(actual);if(!verified)goto done;
  LARGE_INTEGER zero;zero.QuadPart=0;
  if(!SetFilePointerEx(handle,zero,NULL,FILE_BEGIN)||!SetEndOfFile(handle))goto done;
  size_t offset=0;
  while(offset<length){DWORD count=0;if(!WriteFile(handle,bytes+offset,(DWORD)(length-offset),&count,NULL)||count==0)goto done;offset+=count;}
  if(!FlushFileBuffers(handle)||napi_get_boolean(env,true,&result)!=napi_ok)result=NULL;
done:
  if(handle!=INVALID_HANDLE_VALUE&&!CloseHandle(handle))result=NULL;free(path);free(bytes);free(user);free(acl);return result?result:fail(env);
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={
    {"inspect",NULL,inspect,NULL,NULL,NULL,napi_default,NULL},
    {"protectFile",NULL,protect,NULL,NULL,NULL,napi_default,NULL},
    {"protectDirectory",NULL,protect_directory,NULL,NULL,NULL,napi_default,NULL},
    {"createPrivateDirectory",NULL,create_directory,NULL,NULL,NULL,napi_default,NULL},
    {"processBirth",NULL,birth,NULL,NULL,NULL,napi_default,NULL},
    {"writePrivateFile",NULL,write_private,NULL,NULL,NULL,napi_default,NULL}
  };
  if(napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods)!=napi_ok)return fail(env);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
