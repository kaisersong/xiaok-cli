#ifndef XIAOK_REVIEW_PANEL_H
#define XIAOK_REVIEW_PANEL_H
#include <stddef.h>
#include <stdint.h>
/* Owns no authority. Caller remains root and rechecks currentness after return. */
int xiaok_review_panel(const unsigned char *bytes,size_t length,unsigned int uid,unsigned int session,uint64_t deadline,const char *purpose,int (*current)(unsigned int,unsigned int,uint64_t));
/* Allocated exact ASCII view, caller frees; never decodes escapes or omits data. */
char *xiaok_review_text(const unsigned char *bytes,size_t length);
char *xiaok_review_text_for_purpose(const unsigned char *bytes,size_t length,const char *purpose);
/* Application-only fixed frames; returns complete owned ASCII review or NULL. */
unsigned char *xiaok_read_application_review(int fd,size_t *length);
#endif
