#import <Foundation/Foundation.h>
#import <OpenDirectory/OpenDirectory.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <stdlib.h>
/* Read-only OS identity evidence. The installed root broker binds the requested
 * numeric UID to its kernel-authenticated caller; these bytes alone are no grant. */
int main(int argc,char **argv){@autoreleasepool{
 if(argc!=2||!argv[1][0]||argv[1][0]=='-')return 64;
 char *end=NULL;errno=0;unsigned long raw=strtoul(argv[1],&end,10);
 if(errno||!end||*end||!raw||raw>=UINT_MAX)return 64;
 uid_t uid=(uid_t)raw;if(geteuid()!=0&&(getuid()!=uid||geteuid()!=uid))return 77;
 NSError *error=nil;ODNode *node=[ODNode nodeWithSession:[ODSession defaultSession] type:kODNodeTypeLocalNodes error:&error];
 if(error||!node)return 65;
 NSString *numeric=[NSString stringWithFormat:@"%u",uid];
 ODQuery *query=[ODQuery queryWithNode:node forRecordTypes:kODRecordTypeUsers attribute:kODAttributeTypeUniqueID matchType:kODMatchEqualTo queryValues:numeric returnAttributes:@[kODAttributeTypeUniqueID,kODAttributeTypeGUID] maximumResults:2 error:&error];
 if(error||!query)return 65;
 NSArray *records=[query resultsAllowingPartial:NO error:&error];if(error||records.count!=1)return 65;
 ODRecord *record=records.firstObject;NSArray *ids=[record valuesForAttribute:kODAttributeTypeUniqueID error:&error];if(error||ids.count!=1||![ids.firstObject isEqual:numeric])return 65;
 NSArray *generations=[record valuesForAttribute:kODAttributeTypeGUID error:&error];if(error||generations.count!=1||![generations.firstObject isKindOfClass:[NSString class]])return 65;
 NSUUID *generation=[[NSUUID alloc] initWithUUIDString:generations.firstObject];if(!generation)return 65;
 NSDictionary *facts=@{@"uid":@(uid),@"accountGeneration":generation.UUIDString,@"source":@"macos-local-generateduid"};
 NSData *json=[NSJSONSerialization dataWithJSONObject:facts options:NSJSONWritingSortedKeys error:&error];if(error||!json||json.length>1024)return 65;
 const unsigned char *bytes=json.bytes;size_t offset=0;while(offset<json.length){ssize_t n=write(STDOUT_FILENO,bytes+offset,json.length-offset);if(n<=0)return 74;offset+=(size_t)n;}
 return 0;
}}
