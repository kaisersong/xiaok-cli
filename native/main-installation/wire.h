#ifndef XIAOK_MAIN_INSTALLATION_WIRE_H
#define XIAOK_MAIN_INSTALLATION_WIRE_H
#include "protocol.h"
/* Native-internal only; never expose these functions as raw N-API callbacks. */
void mi_zero(void *,size_t);
uint64_t mi_now_ms(void);
int mi_random(void *,size_t);
int mi_birth_encode(const mi_birth *,unsigned char [MI_BIRTH_BYTES]);
int mi_birth_decode(const unsigned char [MI_BIRTH_BYTES],mi_birth *);
int mi_derive_key(const mi_birth *,uint8_t,unsigned char [32]);
int mi_finalize_key(const mi_birth *,uint8_t,const unsigned char [32],const unsigned char [32],const unsigned char [32],unsigned char [32]);
int mi_frame_encode(const unsigned char [32],const mi_frame *,const unsigned char *,unsigned char *,size_t,size_t *);
int mi_frame_decode(const unsigned char [32],const unsigned char *,size_t,mi_frame *,unsigned char *,size_t);
int mi_frame_peek_size(const unsigned char *,size_t,size_t *);
int mi_read_exact(int,void *,size_t,uint64_t);
int mi_write_exact(int,const void *,size_t,uint64_t);
int mi_wire_send(int,const unsigned char [32],const mi_frame *,const unsigned char *,uint64_t);
int mi_wire_receive(int,const unsigned char [32],mi_frame *,unsigned char *,size_t,uint64_t);
int mi_peer_identity(int,uint32_t *,uint32_t *);
/* Once socket() succeeds, *outfd is owned even on return 0. The original
 * Native caller must attempt cleanup and retain actual close failures. */
int mi_connect_fixed_domain(const mi_birth *,uint8_t,int *,unsigned char [32],unsigned char [32]);
#endif
