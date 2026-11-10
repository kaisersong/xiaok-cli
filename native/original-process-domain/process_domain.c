/* Kernel observations only. This component has no terminal/refund API and
 * makes no no-escape, VFS, CPU, Main-role, or business authority claim. */
#define NAPI_VERSION 8
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#ifdef __APPLE__
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#include <pthread.h>
#include <unistd.h>
#include <uuid/uuid.h>
#endif

#define DOMAIN_MAX_EPOCH UINT64_C(9007199254740991)
#define DOMAIN_MAX_OBSERVATIONS 4096
static const napi_type_tag domain_tag = {UINT64_C(0x372601b39c417e21), UINT64_C(0xba1ac62dc17f0041)};
static const napi_type_tag observation_tag = {UINT64_C(0xc3ef60278db1a1c4), UINT64_C(0x780264b1a4902ef6)};

typedef struct identity {
  uint32_t pid, parent_pid, uid, real_uid;
  uint64_t seconds, microseconds;
} identity;
typedef struct observation {
  identity process;
  uint64_t epoch;
  napi_ref handle;
  struct observation *next;
} observation;
typedef struct domain_state {
  napi_env env;
  napi_ref handle;
  int attempted, closed, fenced, unknown;
  uint64_t epoch;
  unsigned count;
  char boot[37], domain_id[37];
  identity self;
  observation *observations;
#ifdef __APPLE__
  pthread_t thread;
#endif
} domain_state;

static napi_value fail(napi_env env, const char *reason) {
  napi_throw_error(env, reason, reason);
  return NULL;
}
static int property(napi_env env, napi_value value, const char *name, napi_value child) {
  /* Create an own data slot. Ordinary [[Set]] would invoke a late public
   * Object.prototype setter before the original Source can retain its tail. */
  const napi_property_descriptor row = {
    name, NULL, NULL, NULL, NULL, child, napi_default_jsproperty, NULL
  };
  return napi_define_properties(env, value, 1, &row) == napi_ok;
}
static int string(napi_env env, napi_value value, const char *name, const char *text) {
  napi_value output;
  return napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &output) == napi_ok &&
      property(env, value, name, output);
}
static int number(napi_env env, napi_value value, const char *name, uint64_t integer) {
  napi_value output;
  return integer <= DOMAIN_MAX_EPOCH &&
      napi_create_double(env, (double)integer, &output) == napi_ok &&
      property(env, value, name, output);
}
static int boolean(napi_env env, napi_value value, const char *name, int flag) {
  napi_value output;
  return napi_get_boolean(env, flag != 0, &output) == napi_ok &&
      property(env, value, name, output);
}
static int same(const identity *a, const identity *b) {
  return a->pid == b->pid && a->parent_pid == b->parent_pid &&
      a->uid == b->uid && a->real_uid == b->real_uid &&
      a->seconds == b->seconds && a->microseconds == b->microseconds;
}
#ifdef __APPLE__
static int boot_identity(char output[37]) {
  char value[64] = {0};
  size_t size = sizeof(value);
  if (sysctlbyname("kern.bootsessionuuid", value, &size, NULL, 0) != 0 ||
      size != 37 || value[36] != '\0') return 0;
  for (unsigned i = 0; i < 36; ++i) {
    const unsigned char c = (unsigned char)value[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return 0;
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                 (c >= 'A' && c <= 'F'))) return 0;
  }
  memcpy(output, value, 37);
  return 1;
}
static int process_identity(int pid, identity *output) {
  struct proc_bsdinfo row;
  memset(&row, 0, sizeof(row));
  if (pid <= 0 || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &row, sizeof(row)) !=
      (int)sizeof(row) || row.pbi_pid != (uint32_t)pid ||
      row.pbi_start_tvsec == 0 || row.pbi_start_tvusec >= 1000000) return 0;
  output->pid = row.pbi_pid;
  output->parent_pid = row.pbi_ppid;
  output->uid = row.pbi_uid;
  output->real_uid = row.pbi_ruid;
  output->seconds = row.pbi_start_tvsec;
  output->microseconds = row.pbi_start_tvusec;
  return 1;
}
static int sample(domain_state *state, int pid, identity *result) {
  char before[37], after[37];
  identity a, b, self;
  if ((uint32_t)getpid() != state->self.pid || !pthread_equal(state->thread, pthread_self()) ||
      !boot_identity(before) || !process_identity(pid, &a) ||
      !process_identity((int)state->self.pid, &self) || !same(&state->self, &self) ||
      !process_identity(pid, &b) || !boot_identity(after) ||
      strcmp(before, state->boot) || strcmp(after, state->boot) || !same(&a, &b)) {
    state->unknown = 1;
    return 0;
  }
  *result = a;
  return 1;
}
#endif
static int active(napi_env env, domain_state *state) {
  if (!state || state->env != env) { fail(env, "OS_DOMAIN_MEMBER_REQUIRED"); return 0; }
  if (state->closed) { fail(env, "OS_DOMAIN_CLOSED"); return 0; }
  if (state->unknown) { fail(env, "OS_DOMAIN_UNCONFIRMED"); return 0; }
  if (state->fenced) { fail(env, "OS_DOMAIN_FENCED"); return 0; }
#ifdef __APPLE__
  if ((uint32_t)getpid() != state->self.pid || !pthread_equal(state->thread, pthread_self())) {
    state->unknown = 1;
    fail(env, "OS_DOMAIN_UNCONFIRMED"); return 0;
  }
#endif
  return 1;
}
static domain_state *member(napi_env env, napi_value input) {
  bool tagged = false;
  domain_state *current = NULL, *wrapped = NULL;
  /* No JS property/internal field is read before the native membership tag. */
  if (napi_get_instance_data(env, (void **)&current) != napi_ok || !current ||
      napi_check_object_type_tag(env, input, &domain_tag, &tagged) != napi_ok || !tagged ||
      napi_unwrap(env, input, (void **)&wrapped) != napi_ok || wrapped != current ||
      wrapped->env != env) {
    fail(env, "OS_DOMAIN_MEMBER_REQUIRED"); return NULL;
  }
  return wrapped;
}
static int arguments(napi_env env, napi_callback_info info, size_t expected, napi_value *values) {
  size_t count = expected + 1;
  napi_value buffer[4];
  if (count > 4 || napi_get_cb_info(env, info, &count, buffer, NULL, NULL) != napi_ok ||
      count != expected) { fail(env, "OS_DOMAIN_ARGUMENTS_INVALID"); return 0; }
  for (size_t i = 0; i < expected; ++i) values[i] = buffer[i];
  return 1;
}
static napi_value birth(napi_env env, const identity *row) {
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok ||
      !number(env, value, "seconds", row->seconds) ||
      !number(env, value, "microseconds", row->microseconds) ||
      napi_object_freeze(env, value) != napi_ok) return NULL;
  return value;
}
static napi_value project(napi_env env, domain_state *state, const observation *row) {
  napi_value value, self_birth = birth(env, &state->self);
  if (!self_birth || napi_create_object(env, &value) != napi_ok ||
      !number(env, value, "schemaVersion", 1) ||
      !string(env, value, "kind", row ? "original_local_os_process_observation_v1" :
          "original_local_os_self_observation_v1") ||
      !string(env, value, "identityBinding", row ? "pid_sample_only" : "self_kernel_double_sample") ||
      !string(env, value, "domainId", state->domain_id) ||
      !string(env, value, "hostBootIdentity", state->boot) ||
      !number(env, value, "observerPid", state->self.pid) ||
      !number(env, value, "observerUid", state->self.uid) ||
      !number(env, value, "observerRealUid", state->self.real_uid) ||
      !property(env, value, "observerBirth", self_birth))
    return fail(env, "OS_DOMAIN_PROJECTION_FAILED");
  if (row) {
    napi_value observed_birth = birth(env, &row->process);
    if (!observed_birth || !number(env, value, "observedPid", row->process.pid) ||
        !number(env, value, "observedParentPid", row->process.parent_pid) ||
        !number(env, value, "observedUid", row->process.uid) ||
        !number(env, value, "observedRealUid", row->process.real_uid) ||
        !number(env, value, "observationEpoch", row->epoch) ||
        !property(env, value, "observedBirth", observed_birth))
      return fail(env, "OS_DOMAIN_PROJECTION_FAILED");
  }
  if (napi_object_freeze(env, value) != napi_ok) return fail(env, "OS_DOMAIN_PROJECTION_FAILED");
  return value;
}
static napi_value open_original(napi_env env, napi_callback_info info) {
  if (!arguments(env, info, 0, NULL)) return NULL;
  domain_state *state = NULL;
  if (napi_get_instance_data(env, (void **)&state) != napi_ok || !state)
    return fail(env, "OS_DOMAIN_UNAVAILABLE");
  if (state->attempted) {
    napi_value handle;
    if (!active(env, state)) return NULL;
    if (napi_get_reference_value(env, state->handle, &handle) != napi_ok)
      return fail(env, "OS_DOMAIN_UNCONFIRMED");
    return handle;
  }
  /* Reserve the environment's only birth before the first kernel SDK call. */
  state->attempted = 1;
  state->epoch = 1;
#ifdef __APPLE__
  state->thread = pthread_self();
  char after[37];
  identity repeat;
  if (!boot_identity(state->boot) || !process_identity(getpid(), &state->self) ||
      !process_identity(getpid(), &repeat) || !boot_identity(after) ||
      strcmp(after, state->boot) || !same(&state->self, &repeat) ||
      state->self.uid != geteuid() || state->self.real_uid != getuid()) {
    state->unknown = 1;
    return fail(env, "OS_DOMAIN_UNCONFIRMED");
  }
  uuid_t id;
  uuid_generate_random(id);
  uuid_unparse_lower(id, state->domain_id);
  napi_value handle;
  if (napi_create_object(env, &handle) != napi_ok ||
      napi_type_tag_object(env, handle, &domain_tag) != napi_ok ||
      napi_wrap(env, handle, state, NULL, NULL, NULL) != napi_ok ||
      napi_create_reference(env, handle, 1, &state->handle) != napi_ok ||
      napi_object_freeze(env, handle) != napi_ok) {
    state->unknown = 1;
    return fail(env, "OS_DOMAIN_UNCONFIRMED");
  }
  return handle;
#else
  state->unknown = 1;
  return fail(env, "OS_DOMAIN_PLATFORM_UNAVAILABLE");
#endif
}
static napi_value read_self(napi_env env, napi_callback_info info) {
  napi_value args[1];
  if (!arguments(env, info, 1, args)) return NULL;
  domain_state *state = member(env, args[0]);
  return state ? project(env, state, NULL) : NULL;
}
static napi_value observe_pid(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (!arguments(env, info, 2, args)) return NULL;
  domain_state *state = member(env, args[0]);
  if (!active(env, state)) return NULL;
  double value = 0;
  if (napi_get_value_double(env, args[1], &value) != napi_ok || !isfinite(value) ||
      value < 1 || value > INT32_MAX || value != (double)(int32_t)value)
    return fail(env, "OS_DOMAIN_PID_INVALID");
  if (state->count >= DOMAIN_MAX_OBSERVATIONS) return fail(env, "OS_DOMAIN_CAPACITY");
#ifdef __APPLE__
  identity sampled;
  if (!sample(state, (int)value, &sampled)) return fail(env, "OS_DOMAIN_UNCONFIRMED");
  observation *row = calloc(1, sizeof(*row));
  if (!row) { state->unknown = 1; return fail(env, "OS_DOMAIN_UNCONFIRMED"); }
  row->process = sampled;
  row->epoch = state->epoch;
  /* Strongly attach the record before creating its JS-visible member. */
  row->next = state->observations;
  state->observations = row;
  state->count++;
  napi_value handle;
  if (napi_create_object(env, &handle) != napi_ok ||
      napi_type_tag_object(env, handle, &observation_tag) != napi_ok ||
      napi_wrap(env, handle, row, NULL, NULL, NULL) != napi_ok ||
      napi_create_reference(env, handle, 1, &row->handle) != napi_ok ||
      napi_object_freeze(env, handle) != napi_ok) {
    state->unknown = 1;
    return fail(env, "OS_DOMAIN_UNCONFIRMED");
  }
  return handle;
#else
  return fail(env, "OS_DOMAIN_PLATFORM_UNAVAILABLE");
#endif
}
static observation *observation_member(napi_env env, domain_state *state, napi_value input) {
  bool tagged = false;
  observation *row = NULL;
  if (!state || napi_check_object_type_tag(env, input, &observation_tag, &tagged) != napi_ok ||
      !tagged || napi_unwrap(env, input, (void **)&row) != napi_ok)
    { fail(env, "OS_DOMAIN_OBSERVATION_REQUIRED"); return NULL; }
  for (observation *known = state->observations; known; known = known->next)
    if (known == row) return row;
  fail(env, "OS_DOMAIN_OBSERVATION_REQUIRED"); return NULL;
}
static napi_value read_observation(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (!arguments(env, info, 2, args)) return NULL;
  domain_state *state = member(env, args[0]);
  observation *row = observation_member(env, state, args[1]);
  return row ? project(env, state, row) : NULL;
}
static napi_value assert_observation(napi_env env, napi_callback_info info) {
  napi_value args[2], nothing;
  if (!arguments(env, info, 2, args)) return NULL;
  domain_state *state = member(env, args[0]);
  observation *row = observation_member(env, state, args[1]);
  if (!row || !active(env, state)) return NULL;
  if (row->epoch != state->epoch) return fail(env, "OS_DOMAIN_FENCED");
#ifdef __APPLE__
  identity current;
  if (!sample(state, (int)row->process.pid, &current) || !same(&current, &row->process)) {
    state->unknown = 1;
    return fail(env, "OS_DOMAIN_UNCONFIRMED");
  }
#endif
  napi_get_undefined(env, &nothing);
  return nothing;
}
static napi_value read_fence(napi_env env, napi_callback_info info) {
  napi_value args[1], value;
  if (!arguments(env, info, 1, args)) return NULL;
  domain_state *state = member(env, args[0]);
  if (!state) return NULL;
  if (napi_create_object(env, &value) != napi_ok ||
      !number(env, value, "epoch", state->epoch) ||
      !boolean(env, value, "fenced", state->fenced) ||
      !boolean(env, value, "unknown", state->unknown) ||
      !boolean(env, value, "closed", state->closed) || napi_object_freeze(env, value) != napi_ok)
    return fail(env, "OS_DOMAIN_PROJECTION_FAILED");
  return value;
}
static napi_value fence(napi_env env, napi_callback_info info) {
  napi_value args[1], nothing;
  if (!arguments(env, info, 1, args)) return NULL;
  domain_state *state = member(env, args[0]);
  if (!state) return NULL;
  if (state->epoch >= DOMAIN_MAX_EPOCH) {
    state->unknown = 1;
    return fail(env, "OS_DOMAIN_UNCONFIRMED");
  }
  state->epoch++;
  state->fenced = 1;
  napi_get_undefined(env, &nothing);
  return nothing;
}
static napi_value close_domain(napi_env env, napi_callback_info info) {
  napi_value args[1], nothing;
  if (!arguments(env, info, 1, args)) return NULL;
  domain_state *state = member(env, args[0]);
  if (!state) return NULL;
  state->closed = 1;
  state->fenced = 1;
  napi_get_undefined(env, &nothing);
  return nothing;
}
static void cleanup(napi_env env, void *data, void *hint) {
  (void)hint;
  domain_state *state = data;
  observation *row = state->observations;
  while (row) {
    observation *next = row->next;
    if (row->handle) napi_delete_reference(env, row->handle);
    free(row); row = next;
  }
  if (state->handle) napi_delete_reference(env, state->handle);
  free(state);
}
static napi_value initialize(napi_env env, napi_value exports) {
  domain_state *state = calloc(1, sizeof(*state));
  if (!state) return fail(env, "OS_DOMAIN_UNAVAILABLE");
  state->env = env;
  if (napi_set_instance_data(env, state, cleanup, NULL) != napi_ok) {
    free(state); return fail(env, "OS_DOMAIN_UNAVAILABLE");
  }
  const napi_property_descriptor methods[] = {
    {"openOriginal", NULL, open_original, NULL, NULL, NULL, napi_default, NULL},
    {"readSelf", NULL, read_self, NULL, NULL, NULL, napi_default, NULL},
    {"observePid", NULL, observe_pid, NULL, NULL, NULL, napi_default, NULL},
    {"readObservation", NULL, read_observation, NULL, NULL, NULL, napi_default, NULL},
    {"assertObservationCurrent", NULL, assert_observation, NULL, NULL, NULL, napi_default, NULL},
    {"readFence", NULL, read_fence, NULL, NULL, NULL, napi_default, NULL},
    {"fence", NULL, fence, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_domain, NULL, NULL, NULL, napi_default, NULL},
  };
  if (napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok ||
      napi_object_freeze(env, exports) != napi_ok) return fail(env, "OS_DOMAIN_UNAVAILABLE");
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
