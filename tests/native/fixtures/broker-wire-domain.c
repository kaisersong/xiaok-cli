#include "wire.h"
#include <stdio.h>
#include <string.h>
static void hex(const unsigned char *p){for(int i=0;i<32;i++)printf("%02x",p[i]);}
int main(void){
 mi_birth b={0};b.helper_pid=7;b.child_pid=11;b.uid=502;
 for(int i=0;i<32;i++){b.nonce[i]=(unsigned char)i;b.seed[i]=(unsigned char)(i+32);}
 unsigned char pre[4][32],final[4][32],client[32],server[32],release[32];memset(client,0x33,32);memset(server,0x44,32);memset(release,0x55,32);
 for(int i=0;i<4;i++)if(!mi_derive_key(&b,(uint8_t)(i+1),pre[i])||!mi_finalize_key(&b,(uint8_t)(i+1),client,server,release,final[i])){printf("{\"domain4Available\":false}\n");return 0;}
 unsigned char out[MI_HEADER_BYTES+3],plain[3],scratch[32];size_t n=0;mi_frame f={0},r={0};f.domain=4;f.operation=28;f.sequence=1;f.payload_length=3;memcpy(f.nonce,b.nonce,32);
 int good=1;
 for(int op=28;op<=30;op++){
  f.operation=(uint16_t)op;good=good&&mi_frame_encode(final[3],&f,(const unsigned char*)"abc",out,sizeof(out),&n)&&mi_frame_decode(final[3],out,n,&r,plain,sizeof(plain))&&r.domain==4&&r.operation==(uint16_t)op&&!memcmp(plain,"abc",3);
  good=good&&!mi_frame_decode(final[2],out,n,&r,plain,sizeof(plain));out[7]=3;good=good&&!mi_frame_decode(final[3],out,n,&r,plain,sizeof(plain));
 }
 const int bad_domains[]={0,5,255};for(int i=0;i<3;i++){f.domain=(uint8_t)bad_domains[i];good=good&&!mi_derive_key(&b,f.domain,scratch)&&!mi_frame_encode(final[3],&f,(const unsigned char*)"abc",out,sizeof(out),&n);}
 const int bad_ops[]={0,27,31,32767};f.domain=4;for(int i=0;i<4;i++){f.operation=(uint16_t)bad_ops[i];good=good&&!mi_frame_encode(final[3],&f,(const unsigned char*)"abc",out,sizeof(out),&n);}
 printf("{\"domain4Available\":true,\"frameAndNegativeChecks\":%s,\"pre\":[",good?"true":"false");for(int i=0;i<4;i++){if(i)printf(",");printf("\"");hex(pre[i]);printf("\"");}printf("],\"final\":[");for(int i=0;i<4;i++){if(i)printf(",");printf("\"");hex(final[i]);printf("\"");}printf("]}\n");return good?0:1;
}
