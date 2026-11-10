#import <AppKit/AppKit.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=2)return 2;char *end=NULL;long value=strtol(argv[1],&end,10);if(!end||*end||value<1||value>2147483647)return 2;
 NSRunningApplication *application=[NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)value];if(!application)return 3;
 NSDictionary *row=@{@"pid":@(application.processIdentifier),@"activationPolicy":@(application.activationPolicy),@"bundlePath":application.bundleURL.path?:@"",@"executablePath":application.executableURL.path?:@""};
 NSData *data=[NSJSONSerialization dataWithJSONObject:row options:0 error:nil];fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;
}}
