/* Local kernel time domain only, never a claim of UTC accuracy. Unlike ordinary
 * monotonic/absolute time these APIs include system suspension. */
#include <stdint.h>
#include <stdio.h>
#include <inttypes.h>
#ifdef __APPLE__
#include <mach/mach_time.h>
#elif defined(__linux__)
#include <time.h>
#else
#error continuous_clock_platform_requires_implementation
#endif
int main(int argc,char **argv){
 (void)argv;if(argc!=1)return 64;
 uint64_t ns;
#ifdef __APPLE__
 mach_timebase_info_data_t info;if(mach_timebase_info(&info)!=KERN_SUCCESS||info.denom==0)return 70;
 __uint128_t value=(__uint128_t)mach_continuous_time()*info.numer/info.denom;if(value>UINT64_MAX)return 70;ns=(uint64_t)value;
 const char *kind="mach-continuous";
#else
 struct timespec value;if(clock_gettime(CLOCK_BOOTTIME,&value)||value.tv_sec<0||value.tv_nsec<0||value.tv_nsec>=1000000000)return 70;
 __uint128_t wide=(__uint128_t)value.tv_sec*1000000000+value.tv_nsec;if(wide>UINT64_MAX)return 70;ns=(uint64_t)wide;
 const char *kind="linux-boottime";
#endif
 printf("{\"kind\":\"%s\",\"nanoseconds\":\"%" PRIu64 "\"}\n",kind,ns);return 0;
}
