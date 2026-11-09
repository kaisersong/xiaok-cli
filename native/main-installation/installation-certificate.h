#ifndef XIAOK_INSTALLATION_CERTIFICATE_H
#define XIAOK_INSTALLATION_CERTIFICATE_H
#include "installation-release.h"
#define MI_INSTALLATION_CERTIFICATE_BYTES 120u
static __attribute__((unused)) uint32_t mi_certificate_u32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static __attribute__((unused)) void mi_certificate_p32(unsigned char *p,uint32_t value){p[0]=(unsigned char)(value>>24);p[1]=(unsigned char)(value>>16);p[2]=(unsigned char)(value>>8);p[3]=(unsigned char)value;}
static __attribute__((unused)) int mi_guid_shape(const unsigned char guid[36]){for(size_t i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(guid[i]!='-')return 0;}else if(!((guid[i]>='0'&&guid[i]<='9')||(guid[i]>='A'&&guid[i]<='F')||(guid[i]>='a'&&guid[i]<='f')))return 0;}return 1;}
static __attribute__((unused)) int mi_certificate_decode(const unsigned char *bytes,size_t size,int component){
 if(component!=0&&component!=1)return 0;const char *magic=component?"XMTEST01":"XMINST01";
 return bytes&&size==120&&!memcmp(bytes,magic,8)&&mi_certificate_u32(bytes+8)==1&&mi_certificate_u32(bytes+12)>0&&mi_certificate_u32(bytes+12)!=UINT32_MAX&&mi_guid_shape(bytes+80)&&mi_certificate_u32(bytes+116)==31;
}
static __attribute__((unused)) void mi_certificate_encode(unsigned char out[120],uint32_t uid,const unsigned char release[32],const unsigned char main[32],const unsigned char guid[36]){
 memset(out,0,120);
#ifdef MI_INSTALLATION_CERT_COMPONENT_BUILD
 memcpy(out,"XMTEST01",8);
#else
 memcpy(out,"XMINST01",8);
#endif
 mi_certificate_p32(out+8,1);mi_certificate_p32(out+12,uid);memcpy(out+16,release,32);memcpy(out+48,main,32);memcpy(out+80,guid,36);mi_certificate_p32(out+116,31);
}
#endif
