#ifndef XIAOK_FIXED_BROKER_CHILD_PROTOCOL_H
#define XIAOK_FIXED_BROKER_CHILD_PROTOCOL_H
#include "../main-installation/protocol.h"
#ifndef MI_BROKER_LAUNCHER_EXEC
#define MI_BROKER_LAUNCHER_EXEC MI_MAIN_BUNDLE "/Contents/Resources/native/broker-child-launcher"
#endif
#ifndef MI_BROKER_EXEC
#define MI_BROKER_EXEC MI_MAIN_EXEC
#endif
#ifndef MI_BROKER_ENTRY
#define MI_BROKER_ENTRY MI_MAIN_BUNDLE "/Contents/Resources/services/intent-broker/src/runtime/original-authority-bootstrap.js"
#endif
#ifndef MI_EXPECTED_BROKER_SHA256
#define MI_EXPECTED_BROKER_SHA256 ""
#endif
#define MI_BROKER_BIRTH_BYTES 188u
#define MI_BROKER_PREPARE_REPLY_BYTES 64u
#if defined(__cplusplus)
static_assert(MI_BROKER_PREPARE>MI_KSWARM_RETIRE && MI_BROKER_PUBLISH==29 && MI_BROKER_RETIRE==30,"closed Broker operation range");
#else
_Static_assert(MI_BROKER_PREPARE>MI_KSWARM_RETIRE && MI_BROKER_PUBLISH==29 && MI_BROKER_RETIRE==30,"closed Broker operation range");
#endif
#endif
