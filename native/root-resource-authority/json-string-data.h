static char *nr_json_string(const char *value){
 size_t length=strlen(value);if(length>1048576)return NULL;
 char *out=malloc(length*6+3);if(!out)return NULL;
 static const char hex[]="0123456789abcdef";char *p=out;*p++='"';
 for(size_t i=0;i<length;i++){
  unsigned char c=(unsigned char)value[i];
  if(c=='"'||c=='\\'){*p++='\\';*p++=(char)c;}
  else if(c<32){*p++='\\';*p++='u';*p++='0';*p++='0';*p++=hex[c>>4];*p++=hex[c&15];}
  else *p++=(char)c;
 }
 *p++='"';*p=0;return out;
}
