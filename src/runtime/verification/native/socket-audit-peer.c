#define _DARWIN_C_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <stdio.h>
#include <bsm/libbsm.h>
/* Only accepted AF_UNIX fd3 from installed service; no claimed identity JSON. */
int main(void) {
 struct sockaddr_storage address;socklen_t size=sizeof(address);
 if(getpeername(3,(struct sockaddr*)&address,&size)||address.ss_family!=AF_UNIX)return 65;
 audit_token_t token;size=sizeof(token);
 if(getsockopt(3,SOL_LOCAL,LOCAL_PEERTOKEN,&token,&size)||size!=sizeof(token))return 66;
 uid_t uid;gid_t gid;if(getpeereid(3,&uid,&gid))return 66;
 if(uid!=audit_token_to_euid(token)||gid!=audit_token_to_egid(token))return 66;
 printf("{\"uid\":%llu,\"gid\":%llu,\"auditSessionId\":%llu,\"pid\":%lld}\n",(unsigned long long)uid,(unsigned long long)gid,(unsigned long long)audit_token_to_asid(token),(long long)audit_token_to_pid(token));return 0;
}
