#ifndef XIAOK_MAIN_INSTALLATION_PROTOCOL_H
#define XIAOK_MAIN_INSTALLATION_PROTOCOL_H
#include <stdint.h>
#include <stddef.h>
/* Fixed Native ABI. No pointer, key, path or descriptor is a JS wire value. */
#define MI_PROTOCOL_VERSION 2u
#define MI_STORE_IDENTITY_BYTES 424u
/* Fixed authority extension; original RootNMP v2 frames are unchanged. */
#define MI_AUTHORITY_REQUEST_PREFIX 52u
#define MI_AUTHORITY_RESULT_PREFIX 24u
#define MI_AUTHORITY_OPEN_REPLY_BYTES 480u
#define MI_AUTHORITY_MAX_LEASES 64u
#define MI_AUTHORITY_MAX_INNER (MI_MAX_PAYLOAD-MI_AUTHORITY_REQUEST_PREFIX)
#define MI_AUTHORITY_MAX_READ (MI_MAX_PAYLOAD-MI_AUTHORITY_RESULT_PREFIX)
#define MI_AUTHORITY_MAX_JOURNAL_WRITE (MI_AUTHORITY_MAX_INNER-40u)
#define MI_STORE_ANCHOR_BYTES 320u
#define MI_STORE_RECEIPT_BYTES 512u
#define MI_BIRTH_FD 198
#define MI_BIRTH_BYTES 88u
#define MI_HEADER_BYTES 104u
#define MI_MAX_PAYLOAD 65536u
#define MI_MAX_FRAME (MI_HEADER_BYTES+MI_MAX_PAYLOAD)
#define MI_FRAME_TIMEOUT_MS 5000u
#define MI_RESPONSE 0x8000u
#ifdef MI_CONFIGURATION_HEADER
#include MI_CONFIGURATION_HEADER
#endif
#ifndef MI_FIXED_ROOT
#define MI_FIXED_ROOT "/Library/Application Support/xiaok-verification/main-installation"
#endif
#ifndef MI_MAIN_EXEC
#define MI_MAIN_EXEC "/Library/Application Support/xiaok-verification/main-installation/Xiaok.app/Contents/MacOS/Xiaok"
#endif
#ifndef MI_LAUNCHER_EXEC
#define MI_LAUNCHER_EXEC MI_FIXED_ROOT "/main-installation-entry"
#endif
#ifndef MI_MAIN_BUNDLE
#define MI_MAIN_BUNDLE "/Library/Application Support/xiaok-verification/main-installation/Xiaok.app"
#endif
#ifndef MI_EXPECTED_MAIN_SHA256
#define MI_EXPECTED_MAIN_SHA256 ""
#endif
#ifdef MI_FIXTURE_BUILD
#define MI_BUILD_KIND 1u
#else
#define MI_BUILD_KIND 0u
#endif
#define MI_SOCKET_BASENAME "main.sock"
#define MI_AUTHORITY_BASENAME "authority"
#define MI_DATABASE_BASENAME "root-resource.sqlite"
/* The child domain can only dispatch the already selected KS family token. */
#ifndef MI_KSWARM_LAUNCHER_EXEC
#define MI_KSWARM_LAUNCHER_EXEC MI_MAIN_BUNDLE "/Contents/Resources/native/kswarm-child-launcher"
#endif
#ifndef MI_KSWARM_EXEC
#define MI_KSWARM_EXEC MI_MAIN_EXEC
#endif
#ifndef MI_KSWARM_ENTRY
#define MI_KSWARM_ENTRY MI_MAIN_BUNDLE "/Contents/Resources/services/kswarm/src/server/original-authority-bootstrap.js"
#endif
#ifndef MI_EXPECTED_KSWARM_SHA256
#define MI_EXPECTED_KSWARM_SHA256 ""
#endif
#define MI_KSWARM_BIRTH_BYTES 188u
#define MI_KSWARM_PREPARE_REPLY_BYTES 64u
enum mi_domain { MI_ROOT_IO=1, MI_DISPATCH=2, MI_KSWARM_IO=3, MI_BROKER_IO=4 };
enum mi_slot { MI_SLOT_NONE=0, MI_DATABASE=1, MI_JOURNAL=2, MI_ISSUER_LOCK=3 };
enum mi_operation { MI_HELLO=1, MI_PING=2, MI_READ=3, MI_WRITE=4, MI_SIZE=5,
 MI_TRUNCATE=6, MI_SYNC=7, MI_LOCK=8, MI_UNLOCK=9, MI_CHECK_RESERVED=10,
 MI_JOURNAL_EXISTS=11, MI_JOURNAL_CREATE=12, MI_JOURNAL_DELETE=13,
 MI_DIRECTORY_SYNC=14, MI_CLOSE=15, MI_STORE_IDENTITY=16,
 MI_CLAIM_FRESH=17, MI_BIND_BOOTSTRAP=18, MI_JOURNAL_OPEN_EXISTING=19, MI_JOURNAL_CLOSE=20,
 MI_AUTHORITY_OPEN=21, MI_AUTHORITY_REQUEST=22, MI_AUTHORITY_RELEASE=23, MI_KSWARM_PREPARE=24, MI_KSWARM_PUBLISH=25, MI_KSWARM_RETIRE=26,
 MI_BROKER_PREPARE=28, MI_BROKER_PUBLISH=29, MI_BROKER_RETIRE=30,
 MI_CLAIM_ADOPTED=31 };
enum mi_authority_family { MI_FAMILY_ROOT_NMP=1, MI_FAMILY_ADMISSION=2,
 MI_FAMILY_BUDGET=3, MI_FAMILY_KSWARM=4, MI_FAMILY_BROKER=5 };
enum mi_authority_result { MI_AUTHORITY_OK=0, MI_AUTHORITY_KNOWN_DENIED=1,
 MI_AUTHORITY_UNKNOWN_HELD=2, MI_AUTHORITY_BUSY_HELD=3 };
typedef struct mi_birth {
 uint32_t helper_pid, child_pid, uid;
 unsigned char nonce[32], seed[32];
} mi_birth;
typedef struct mi_frame {
 uint8_t domain; uint16_t operation,slot; uint32_t status;
 uint64_t sequence,offset; uint32_t payload_length,amount;
 unsigned char nonce[32];
} mi_frame;
#endif
