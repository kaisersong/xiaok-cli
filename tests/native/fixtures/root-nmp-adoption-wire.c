#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "wire.h"
int main(void) {
  unsigned char key[32], wire[MI_MAX_FRAME], payload[MI_MAX_PAYLOAD];
  memset(key, 7, 32);
  mi_frame request = {0}, decoded = {0};
  request.domain = MI_ROOT_IO;
  request.operation = MI_CLAIM_ADOPTED;
  request.sequence = 9;
  memset(request.nonce, 4, 32);
  size_t n = 0;
  assert(mi_frame_encode(key, &request, NULL, wire, sizeof(wire), &n));
  assert(mi_frame_decode(key, wire, n, &decoded, payload, sizeof(payload)));
  assert(decoded.operation == MI_CLAIM_ADOPTED && decoded.sequence == 9 &&
         decoded.payload_length == 0);
  request.operation = MI_CLAIM_ADOPTED | MI_RESPONSE;
  assert(mi_frame_encode(key, &request, NULL, wire, sizeof(wire), &n));
  request.operation = 32;
  assert(!mi_frame_encode(key, &request, NULL, wire, sizeof(wire), &n));
  puts("{\"kind\":\"actual-original-adoption-wire\",\"opcode31\":true,\"unknown32Denied\":true,"
       "\"productionQualification\":false}");
  return 0;
}
