#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include "review-panel.h"
static int forbidden(unsigned int uid,unsigned int session,uint64_t deadline){(void)uid;(void)session;(void)deadline;abort();}
int main(void){
 const unsigned char exact[]="{\"path\":\"/tmp/\\u4e2d\\u202eevil\",\"command\":\"printf \\\"hi\\\"\"}";
 char *out=xiaok_review_text(exact,sizeof(exact)-1);assert(out&&strlen(out)==sizeof(exact)-1&&!memcmp(out,exact,sizeof(exact)-1));free(out);
 unsigned char *max=malloc(65537);memset(max,'a',65537);out=xiaok_review_text(max,65536);assert(out&&strlen(out)==65536&&!memcmp(out,max,65536));free(out);assert(!xiaok_review_text(max,65537));max[99]=0;assert(!xiaok_review_text(max,65536));free(max);
 unsigned char *large=malloc(7*1024*1024+1);memset(large,'a',7*1024*1024+1);
 out=xiaok_review_text_for_purpose(large,7*1024*1024,"completion-publication");assert(out&&strlen(out)==7*1024*1024&&!memcmp(out,large,7*1024*1024));free(out);
 assert(!xiaok_review_text_for_purpose(large,7*1024*1024+1,"completion-publication"));
 out=xiaok_review_text_for_purpose(large,7*1024*1024,"profile-source-custody");assert(out&&strlen(out)==7*1024*1024&&!memcmp(out,large,7*1024*1024));free(out);
 assert(!xiaok_review_text_for_purpose(large,7*1024*1024+1,"profile-source-custody"));
 assert(!xiaok_review_text_for_purpose(large,65537,"completion-owner-enrollment"));assert(!xiaok_review_text_for_purpose(large,65537,"isolated-materials"));free(large);
 assert(!xiaok_review_text((const unsigned char *)"\033hidden",7));
 /* Ordinary-user path exits before callback/NSApplication, no auth bypass. */
 assert(xiaok_review_panel(exact,sizeof(exact)-1,501,10,100,"isolated-materials",forbidden)==0);
 return 0;
}
