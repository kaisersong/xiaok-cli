#define _DARWIN_C_SOURCE
#include <stdio.h>
#include "../../../native/main-installation/wire.h"
#include "../../../native/root-resource-authority/installed-main-client.h"
#include "../../../native/broker-authority-source/broker-child-launch.h"
#include "../../../native/kswarm-authority-source/kswarm-child-launch.h"
#if !defined(MI_FIXTURE_BUILD) || !defined(NR_ROOT_IO_COMPONENT)
#error "Fixed finite component only"
#endif
int main(void) {
  nm_installed_client *client = nm_installed_create();
  nr_root_store_io *io = NULL;
  const nr_root_bootstrap_claim *claim = NULL;
  nr_root_store_identity identity;
  nm_installed_fate before = {0}, after = {0}, fate = {0};
  int failure = 0;
  if (!client || !nm_installed_connect(client) ||
      !nr_component_borrow_original_root_store(client, &io) ||
      !nr_root_store_read_identity(io, &identity)) { failure = 1; goto close; }
  if (identity.birth_state == NR_CREATED &&
      (!nr_root_store_claim_fresh(io, &claim) ||
       !nr_root_store_read_claim(io, claim, &identity) ||
       !nr_root_store_bind_bootstrap(io, NR_FRESH_COMMIT, claim, &identity))) {
    failure = 2; goto close;
  }
  if (!nm_installed_fate_read(client, &before)) { failure = 3; goto close; }
  nm_broker_child_birth *broker = NULL;
  nm_kswarm_child_birth *kswarm = NULL;
  if (nm_installed_prepare_core_broker_child(client, &broker) || broker ||
      nm_installed_prepare_core_kswarm_child(client, &kswarm) || kswarm ||
      !nm_installed_fate_read(client, &after) ||
      before.root_sequence != after.root_sequence) { failure = 4; goto close; }
close:
  if (io && nr_root_store_release_owned(io) != NR_SQL_FILES_CLOSED) failure = 5;
  if (client && (!nm_installed_close_owned(client) ||
      !nm_installed_fate_read(client, &fate))) failure = 6;
  printf("{\"kind\":\"actual-unsupported-source-producers\",\"failure\":%d,\"rootSequenceUnchanged\":%s,\"rootFilesClosed\":%s,\"platformFactSimulated\":true,\"qualification\":false}\n",
    failure, before.root_sequence == after.root_sequence ? "true" : "false", fate.root_files_closed ? "true" : "false");
  nm_installed_release(client);
  return failure ? 1 : 0;
}
