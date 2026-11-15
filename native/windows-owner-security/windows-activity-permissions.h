/* Ordinary permission observation. Never a Native/DSH authority or verdict cache. */
static const napi_type_tag activity_permission_tag={UINT64_C(0xb013dc585e4348a2),UINT64_C(0xa09e26fa7e371bbc)};
typedef struct ActivityPermissions {
  wchar_t *paths[8],*parent,*expected,*actual;HANDLE root,files[4],scratch;BY_HANDLE_FILE_INFORMATION root_id,ids[4];TOKEN_USER *user;
  int started,ready,failed,close_attempted,closed,scratch_unknown;struct ActivityPermissions *retained_next;
} ActivityPermissions;
static ActivityPermissions *retained_activity_permissions=NULL;
static int activity_same_file(BY_HANDLE_FILE_INFORMATION *a,BY_HANDLE_FILE_INFORMATION *b){return a->dwVolumeSerialNumber==b->dwVolumeSerialNumber&&a->nFileIndexHigh==b->nFileIndexHigh&&a->nFileIndexLow==b->nFileIndexLow;}
static int activity_canonical_path(ActivityPermissions *ctx){
  DWORD length=GetFinalPathNameByHandleW(ctx->root,ctx->actual,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
  if(!length||length>=32768)return 0;
  const wchar_t *value=ctx->actual;
  if(wcsncmp(value,L"\\\\?\\UNC\\",8)==0){ctx->actual[6]=L'\\';value=ctx->actual+6;}
  else if(wcsncmp(value,L"\\\\?\\",4)==0)value=ctx->actual+4;
  return _wcsicmp(value,ctx->expected)==0;
}
static int activity_parent_private(ActivityPermissions *ctx,TOKEN_USER *user){
  BY_HANDLE_FILE_INFORMATION info;PSECURITY_DESCRIPTOR descriptor=NULL;PSID owner=NULL;PACL acl=NULL;int valid=0;
  if(!GetFileInformationByHandle(ctx->root,&info)||!(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||!activity_same_file(&info,&ctx->root_id)||!activity_canonical_path(ctx))return 0;
  if(GetSecurityInfo(ctx->root,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,NULL,&acl,NULL,&descriptor)!=ERROR_SUCCESS||!descriptor||!owner||!protection_owner(owner,user)||!acl||!IsValidAcl(acl))goto done;
  DWORD allows=0;int inheritable=0;
  for(DWORD i=0;i<acl->AceCount;i++){
    void *raw=NULL;if(!GetAce(acl,i,&raw))goto done;ACE_HEADER *header=(ACE_HEADER*)raw;
    if(header->AceType==ACCESS_DENIED_ACE_TYPE)continue;
    if(header->AceType!=ACCESS_ALLOWED_ACE_TYPE||header->AceSize<sizeof(ACCESS_ALLOWED_ACE))goto done;
    ACCESS_ALLOWED_ACE *entry=(ACCESS_ALLOWED_ACE*)raw;PSID principal=(PSID)&entry->SidStart;
    if(header->AceSize<16||GetSidLengthRequired(((SID*)principal)->SubAuthorityCount)>(DWORD)header->AceSize-8||!IsValidSid(principal))goto done;
    int current=EqualSid(principal,user->User.Sid);
    if(!current&&!IsWellKnownSid(principal,WinLocalSystemSid)&&!IsWellKnownSid(principal,WinBuiltinAdministratorsSid))goto done;
    allows++;
    if(current&&entry->Mask==FILE_ALL_ACCESS&&(header->AceFlags&(OBJECT_INHERIT_ACE|CONTAINER_INHERIT_ACE|INHERIT_ONLY_ACE))==(OBJECT_INHERIT_ACE|CONTAINER_INHERIT_ACE))inheritable=1;
  }
  valid=allows>0&&inheritable;
done:
  if(descriptor)LocalFree(descriptor);return valid;
}
static int activity_file_private(HANDLE handle,TOKEN_USER *user,BY_HANDLE_FILE_INFORMATION *original){
  BY_HANDLE_FILE_INFORMATION before,after;PSECURITY_DESCRIPTOR descriptor=NULL;PSID owner=NULL;PACL current=NULL,acl=NULL;int valid=0;
  if(!GetFileInformationByHandle(handle,&before)||(before.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||before.nNumberOfLinks!=1||(original&&!activity_same_file(original,&before)))goto done;
  if(GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&owner,NULL,&current,NULL,&descriptor)!=ERROR_SUCCESS||!owner||!descriptor)goto done;
  if(private_descriptor(descriptor,owner,current,user,0))valid=1;
  else {
    if(!protection_owner(owner,user))goto done;
    DWORD size=(DWORD)(sizeof(ACL)+sizeof(ACCESS_ALLOWED_ACE)-sizeof(DWORD)+GetLengthSid(user->User.Sid));acl=(PACL)calloc(size,1);
    if(!acl||!InitializeAcl(acl,size,ACL_REVISION)||!AddAccessAllowedAceEx(acl,ACL_REVISION,0,FILE_ALL_ACCESS,user->User.Sid)||SetSecurityInfo(handle,SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,NULL,NULL,acl,NULL)!=ERROR_SUCCESS)goto done;
    PSECURITY_DESCRIPTOR actual=NULL;PSID actual_owner=NULL;PACL actual_acl=NULL;
    valid=GetSecurityInfo(handle,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,&actual_owner,NULL,&actual_acl,NULL,&actual)==ERROR_SUCCESS&&actual&&actual_owner&&EqualSid(actual_owner,owner)&&private_descriptor(actual,actual_owner,actual_acl,user,0);
    if(actual)LocalFree(actual);
  }
  if(valid&&(!GetFileInformationByHandle(handle,&after)||!activity_same_file(&before,&after)||(after.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||after.nNumberOfLinks!=1))valid=0;
done:free(acl);if(descriptor)LocalFree(descriptor);return valid;
}
static ActivityPermissions *activity_permissions_value(napi_env env,napi_callback_info info){
  napi_value self;size_t argc=0;bool tagged=false;ActivityPermissions *ctx=NULL;
  if(napi_get_cb_info(env,info,&argc,NULL,&self,NULL)!=napi_ok||napi_check_object_type_tag(env,self,&activity_permission_tag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,self,(void**)&ctx)!=napi_ok)return NULL;return ctx;
}
static napi_value activity_permissions_verify(napi_env env,napi_callback_info info){
  ActivityPermissions *ctx=activity_permissions_value(env,info);if(!ctx||ctx->failed||ctx->close_attempted)return fail(env);
  TOKEN_USER *user=current_user();int temporary=ctx->started,missing=0,valid=0;
  if(!user)goto done;
  if(!ctx->started){
    ctx->started=1;ctx->user=user;temporary=0;ctx->root=open_path(ctx->parent,0);
    if(ctx->root==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(ctx->root,&ctx->root_id)||!activity_parent_private(ctx,user))goto done;
    for(size_t i=0;i<4;i++){
      ctx->files[i]=open_path(ctx->paths[i],1);
      if(ctx->files[i]==INVALID_HANDLE_VALUE){DWORD error=GetLastError();if(i>=2&&error==ERROR_FILE_NOT_FOUND){missing=1;goto done;}goto done;}
      if(!GetFileInformationByHandle(ctx->files[i],&ctx->ids[i])||!activity_file_private(ctx->files[i],user,&ctx->ids[i]))goto done;
    }
    ctx->ready=1;
  }
  if(!ctx->ready||!EqualSid(user->User.Sid,ctx->user->User.Sid))goto done;
  for(size_t i=0;i<4;i++)if(!activity_file_private(ctx->files[i],user,&ctx->ids[i]))goto done;
  for(size_t i=4;i<8;i++){
    DWORD attrs=GetFileAttributesW(ctx->paths[i]);if(attrs==INVALID_FILE_ATTRIBUTES){if(GetLastError()==ERROR_FILE_NOT_FOUND)continue;goto done;}
    ctx->scratch=open_path(ctx->paths[i],1);if(ctx->scratch==INVALID_HANDLE_VALUE||!activity_file_private(ctx->scratch,user,NULL))goto done;
    if(!CloseHandle(ctx->scratch)){ctx->scratch_unknown=1;goto done;}ctx->scratch=INVALID_HANDLE_VALUE;
  }
  if(!activity_parent_private(ctx,user))goto done;valid=1;
done:
  if(temporary)free(user);else if(!ctx->user)free(user);
  if(!valid&&!missing){ctx->failed=1;return fail(env);}
  napi_value result;if(napi_get_boolean(env,valid?true:false,&result)!=napi_ok){ctx->failed=1;return fail(env);}return result;
}
static int activity_permissions_close_handles(ActivityPermissions *ctx){
  if(ctx->closed)return 1;if(ctx->close_attempted)return 0;ctx->close_attempted=1;int valid=!ctx->scratch_unknown;
  if(ctx->scratch!=INVALID_HANDLE_VALUE&&!ctx->scratch_unknown){if(CloseHandle(ctx->scratch))ctx->scratch=INVALID_HANDLE_VALUE;else valid=0;}
  for(size_t i=4;i>0;i--)if(ctx->files[i-1]!=INVALID_HANDLE_VALUE){if(CloseHandle(ctx->files[i-1]))ctx->files[i-1]=INVALID_HANDLE_VALUE;else valid=0;}
  if(ctx->root!=INVALID_HANDLE_VALUE){if(CloseHandle(ctx->root))ctx->root=INVALID_HANDLE_VALUE;else valid=0;}
  if(valid)ctx->closed=1;else ctx->failed=1;return valid;
}
static napi_value activity_permissions_close(napi_env env,napi_callback_info info){
  ActivityPermissions *ctx=activity_permissions_value(env,info);if(!ctx||!activity_permissions_close_handles(ctx))return fail(env);
  napi_value value;if(napi_get_undefined(env,&value)!=napi_ok)return fail(env);return value;
}
static void activity_permissions_free(ActivityPermissions *ctx){for(size_t i=0;i<8;i++)free(ctx->paths[i]);free(ctx->parent);free(ctx->expected);free(ctx->actual);free(ctx->user);free(ctx);}
static void activity_permissions_finalize(napi_env env,void *data,void *hint){
  (void)env;(void)hint;ActivityPermissions *ctx=(ActivityPermissions*)data;
  if(activity_permissions_close_handles(ctx))activity_permissions_free(ctx);
  else {ctx->retained_next=retained_activity_permissions;retained_activity_permissions=ctx;}
}
static napi_value create_activity_permissions(napi_env env,napi_callback_info info){
  /* Capture object ownership before the first OS handle is ever opened. */
  wchar_t *base=argument_path(env,info);if(!base)return fail(env);size_t length=wcslen(base);
  ActivityPermissions *ctx=(ActivityPermissions*)calloc(1,sizeof(ActivityPermissions));if(!ctx){free(base);return fail(env);}
  ctx->root=ctx->scratch=INVALID_HANDLE_VALUE;for(size_t i=0;i<4;i++)ctx->files[i]=INVALID_HANDLE_VALUE;
  const wchar_t *suffixes[]={L"",L".owner.sqlite",L"-wal",L"-shm",L"-journal",L".owner.sqlite-wal",L".owner.sqlite-shm",L".owner.sqlite-journal"};
  if(length+22>32767)goto bad;
  for(size_t i=0;i<length;i++)if(base[i]==L'/')base[i]=L'\\';
  wchar_t *last=wcsrchr(base,L'\\');if(!last||!last[1])goto bad;size_t parent_length=(size_t)(last-base);if(parent_length==2&&base[1]==L':')parent_length++;
  ctx->parent=(wchar_t*)calloc(parent_length+1,sizeof(wchar_t));if(!ctx->parent)goto bad;memcpy(ctx->parent,base,parent_length*sizeof(wchar_t));
  /* Lexical input normalization only; filesystem resolution stays fresh in verify. */
  DWORD expected_size=GetFullPathNameW(ctx->parent,0,NULL,NULL);if(!expected_size||expected_size>32767)goto bad;
  ctx->expected=(wchar_t*)calloc(expected_size+1,sizeof(wchar_t));ctx->actual=(wchar_t*)calloc(32768,sizeof(wchar_t));if(!ctx->expected||!ctx->actual)goto bad;
  DWORD expected_length=GetFullPathNameW(ctx->parent,expected_size+1,ctx->expected,NULL);if(!expected_length||expected_length>expected_size)goto bad;
  for(size_t i=0;i<8;i++){size_t size=length+wcslen(suffixes[i])+1;ctx->paths[i]=(wchar_t*)calloc(size,sizeof(wchar_t));if(!ctx->paths[i])goto bad;wcscpy_s(ctx->paths[i],size,base);wcscat_s(ctx->paths[i],size,suffixes[i]);}
  napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&activity_permission_tag)!=napi_ok)goto bad;
  napi_property_descriptor methods[]={{"verify",NULL,activity_permissions_verify,NULL,NULL,NULL,napi_default,NULL},{"close",NULL,activity_permissions_close,NULL,NULL,NULL,napi_default,NULL}};
  if(napi_define_properties(env,object,2,methods)!=napi_ok)goto bad;
  if(napi_wrap(env,object,ctx,activity_permissions_finalize,NULL,NULL)!=napi_ok)goto bad;
  free(base);return object;
bad:free(base);activity_permissions_free(ctx);return fail(env);
}
