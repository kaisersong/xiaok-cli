/* Same original client DSO and private RootIO registry; no caller facts. */
#include "root-pool-adoption-codec.h"
static int nr_root_store_refresh_adoption(nr_root_store_io *io) {
  unsigned char bytes[NR_ROOT_IDENTITY_WIRE_BYTES + NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES];
  mi_frame reply = {0};
  nr_root_store_identity next;
  nr_original_pool_history history;
  if (!store_request(io, MI_CLAIM_ADOPTED, MI_SLOT_NONE, 0, NULL, 0, 0, &reply, bytes,
                     sizeof(bytes)) ||
      reply.offset || reply.amount ||
      (reply.payload_length != NR_ROOT_IDENTITY_WIRE_BYTES &&
       reply.payload_length != sizeof(bytes)) ||
      !nr_io_identity_decode(bytes, NR_ROOT_IDENTITY_WIRE_BYTES, &next) ||
      !nr_io_identity_same(&io->identity, &next) || next.birth_state < io->identity.birth_state ||
      next.receipt_sequence < io->identity.receipt_sequence)
    return store_failed(io, EPROTO);
  enum nr_root_adoption_kind kind = NR_ROOT_ORDINARY_BINDING;
  if (reply.payload_length == sizeof(bytes)) {
    if (!nr_original_pool_history_decode(bytes + NR_ROOT_IDENTITY_WIRE_BYTES,
                                         NR_ORIGINAL_POOL_HISTORY_WIRE_BYTES, &history) ||
        (next.birth_state != NR_CLAIMED && next.birth_state != NR_BOUND) ||
        next.main_principal_uid != history.main_principal_uid ||
        memcmp(next.pool_id, history.pool_id, 32) ||
        next.database.device != history.database.device ||
        next.database.inode != history.database.inode)
      return store_failed(io, EPROTO);
    kind = NR_ROOT_ADOPTED_BINDING;
  }
  if (io->adoption_checked && io->adoption_kind != kind)
    return store_failed(io, EPROTO);
  io->identity = next;
  io->adoption_checked = 1;
  io->adoption_kind = kind;
  if (kind == NR_ROOT_ADOPTED_BINDING)
    io->adoption_history = history;
  return 1;
}
int nr_root_store_read_adoption_kind(nr_root_store_io *io, enum nr_root_adoption_kind *out) {
  imported_store *remote = imported_io(io);
  if (remote)
    return remote->ops->read_adoption_kind(io, out);
  if (!store_member(io))
    return 0;
  NM_CLIENT_GUARD(io->client, 0);
  if (!out || !store_association(io) || !store_alive(io, 0) || io->client->close_requested ||
      io->family)
    return 0;
  if (!io->adoption_checked && !nr_root_store_refresh_adoption(io))
    return 0;
  *out = io->adoption_kind;
  return 1;
}
int nr_root_store_claim_adopted(nr_root_store_io *io, const nr_root_bootstrap_claim **out) {
  imported_store *remote = imported_io(io);
  if (remote) {
    if (!out)
      return 0;
    int ok = remote->ops->claim_adopted(io, out);
    if (ok)
      remote->claim = *out;
    return ok;
  }
  if (!store_member(io))
    return 0;
  NM_CLIENT_GUARD(io->client, 0);
  if (!out || !store_association(io) || !store_alive(io, 0) || io->client->close_requested ||
      io->family)
    return 0;
  if (io->claim.valid) {
    if (io->claim.kind != 2)
      return 0;
    *out = &io->claim;
    return 1;
  }
  if (io->identity.birth_state != NR_CLAIMED && io->identity.birth_state != NR_BOUND)
    return 0;
  enum nr_root_adoption_kind kind;
  if (!nr_root_store_read_adoption_kind(io, &kind) || kind != NR_ROOT_ADOPTED_BINDING)
    return 0;
  io->claim.io = io;
  io->claim.identity = io->identity;
  io->claim.history = io->adoption_history;
  io->claim.kind = 2;
  io->claim.valid = 1;
  *out = &io->claim;
  return 1;
}
int nr_root_store_read_adoption(nr_root_store_io *io, const nr_root_bootstrap_claim *claim,
                                nr_original_pool_history *history, nr_root_store_identity *out) {
  imported_store *remote = imported_io(io);
  if (remote) {
    if (claim != remote->claim)
      return 0;
    return remote->ops->read_adoption(io, claim, history, out);
  }
  if (!store_member(io))
    return 0;
  NM_CLIENT_GUARD(io->client, 0);
  /* Rows and their inline claims are retained in root_stores after release;
   * no free/reallocation can turn pointer equality into a new active owner. */
  if (!history || !out || !store_association(io) || !store_alive(io, 0) ||
      io->client->close_requested || claim != &io->claim || !io->claim.valid ||
      io->claim.kind != 2 || io->claim.io != io)
    return 0;
  *history = io->claim.history;
  *out = io->claim.identity;
  return 1;
}
