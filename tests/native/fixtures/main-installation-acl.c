#define main mi_original_helper_main
#include "../../../native/main-installation/main-installation-helper.c"
#undef main
#include <membership.h>
#include <uuid/uuid.h>
int main(int argc,char **argv){
 if(argc!=2)return 64;int fd=open(argv[1],O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,0600);if(fd<0)return 81;int empty=safe_acl(fd);acl_t acl=acl_init(1);acl_entry_t entry;acl_permset_t perms;uuid_t user;
 int made=acl&&mbr_uid_to_uuid(getuid(),user)==0&&acl_create_entry(&acl,&entry)==0&&acl_set_tag_type(entry,ACL_EXTENDED_ALLOW)==0&&acl_set_qualifier(entry,user)==0&&acl_get_permset(entry,&perms)==0&&acl_add_perm(perms,ACL_WRITE_DATA)==0&&acl_set_permset(entry,perms)==0&&acl_set_fd_np(fd,acl,ACL_TYPE_EXTENDED)==0;
 int denied=made&&!safe_acl(fd);acl_t blank=acl_init(0);int restored=blank&&acl_set_fd_np(fd,blank,ACL_TYPE_EXTENDED)==0;if(blank)acl_free(blank);if(acl)acl_free(acl);int closed=close(fd)==0;int removed=unlink(argv[1])==0;
 printf("{\"emptyAclAccepted\":%s,\"realWriteGrantCreated\":%s,\"writeGrantDenied\":%s,\"restored\":%s,\"closed\":%s,\"removed\":%s}\n",empty?"true":"false",made?"true":"false",denied?"true":"false",restored?"true":"false",closed?"true":"false",removed?"true":"false");return made&&restored&&closed&&removed?0:82;
}
