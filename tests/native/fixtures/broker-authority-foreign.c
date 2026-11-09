#include "installed-main-client.h"
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <errno.h>
struct nm_broker_child_birth;
extern int nm_installed_prepare_core_broker_child(nm_installed_client *,struct nm_broker_child_birth **);
static int spawns;
int posix_spawn(pid_t *pid,const char *path,const posix_spawn_file_actions_t *files,const posix_spawnattr_t *attributes,char *const args[],char *const environment[]){(void)pid;(void)path;(void)files;(void)attributes;(void)args;(void)environment;spawns++;return ENOSYS;}
int main(void){struct nm_broker_child_birth *out=(struct nm_broker_child_birth *)(uintptr_t)1;int good=!nm_installed_prepare_core_broker_child(NULL,&out)&&!nm_installed_prepare_core_broker_child((nm_installed_client *)(uintptr_t)1,&out)&&out==(struct nm_broker_child_birth *)(uintptr_t)1&&!spawns;printf("{\"foreignCoreRejected\":%s,\"childSpawns\":%d,\"productionQualified\":false}\n",good?"true":"false",spawns);return good?0:1;}
