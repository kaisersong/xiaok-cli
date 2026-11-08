#include "installed-main-client.h"
#include <stdio.h>
/* Fixed proposed C-only producer. A missing real symbol must fail the original
 * native link; this fixture supplies no factory, fake callback table or grant. */
typedef struct nm_kswarm_child_birth nm_kswarm_child_birth;
extern int nm_installed_prepare_core_kswarm_child(nm_installed_client *,
                                                nm_kswarm_child_birth **);
extern int nm_kswarm_child_launch(nm_kswarm_child_birth *);
int main(void) {
  nm_kswarm_child_birth *birth = NULL;
  if (nm_installed_prepare_core_kswarm_child(NULL, &birth) || birth) return 1;
  if (nm_kswarm_child_launch(NULL)) return 2;
  puts("{\"foreignCoreRejected\":true,\"childSpawns\":0,\"productionQualified\":false}");
  return 0;
}
