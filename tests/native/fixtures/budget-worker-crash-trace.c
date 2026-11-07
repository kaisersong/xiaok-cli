/* Diagnostic-only: never compiled into an acceptance or production addon.
 * A signal-time unwinder is not guaranteed async-signal-safe. Record only the
 * kernel-delivered PC/LR/SP/fault address with write(2), then restore and
 * re-deliver the original signal. This cannot turn a crash into known fate. */
#if defined(MI_FIXTURE_BUILD) && defined(NR_BUDGET_DIAGNOSTIC_BACKTRACE)
#include <signal.h>
#include <stdint.h>
#include <unistd.h>
#include <sys/ucontext.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <string.h>

static struct sigaction original_segv;
static volatile sig_atomic_t entered;

static void raw_address(const char *name, size_t length, uintptr_t value) {
  static const char digits[] = "0123456789abcdef";
  char line[2 + 2 * sizeof(uintptr_t) + 1];
  line[0] = '0'; line[1] = 'x';
  for (size_t i = 0; i < 2 * sizeof(uintptr_t); ++i) {
    unsigned shift = (unsigned)((2 * sizeof(uintptr_t) - i - 1) * 4);
    line[2 + i] = digits[(value >> shift) & 15u];
  }
  line[sizeof(line) - 1] = '\n';
  (void)write(STDERR_FILENO, name, length);
  (void)write(STDERR_FILENO, line, sizeof(line));
}

static void trace_segv(int signal_number, siginfo_t *information, void *raw_context) {
  if (!entered) {
    entered = 1;
    static const char heading[] = "ORIGINAL_BUDGET_DIAGNOSTIC_SIGSEGV_RAW\n";
    (void)write(STDERR_FILENO, heading, sizeof(heading) - 1);
    raw_address("fault=", 6, (uintptr_t)information->si_addr);
    ucontext_t *context = (ucontext_t *)raw_context;
#if defined(__APPLE__) && defined(__aarch64__)
    raw_address("pc=", 3, (uintptr_t)context->uc_mcontext->__ss.__pc);
    raw_address("lr=", 3, (uintptr_t)context->uc_mcontext->__ss.__lr);
    raw_address("sp=", 3, (uintptr_t)context->uc_mcontext->__ss.__sp);
#elif defined(__APPLE__) && defined(__x86_64__)
    raw_address("pc=", 3, (uintptr_t)context->uc_mcontext->__ss.__rip);
    raw_address("sp=", 3, (uintptr_t)context->uc_mcontext->__ss.__rsp);
#endif
  }
  (void)sigaction(signal_number, &original_segv, 0);
  /* SIGSEGV is blocked during its handler. The original disposition receives
   * the pending signal when this handler returns; no catch/continue occurs. */
  (void)kill(getpid(), signal_number);
}

__attribute__((constructor)) static void install_budget_diagnostic_trace(void) {
  /* Image enumeration is deliberately outside the signal handler. This is
   * symbolication metadata only, restricted to this process's loaded addons
   * and Electron Framework; it grants no installation or file authority. */
  uint32_t count = _dyld_image_count();
  for (uint32_t index = 0; index < count; ++index) {
    const char *name = _dyld_get_image_name(index);
    if (!name) continue;
    size_t length = strlen(name);
    if (!(length >= 5 && strcmp(name + length - 5, ".node") == 0)
        && !strstr(name, "Electron Framework.framework/")) continue;
    fprintf(stderr, "ORIGINAL_BUDGET_DIAGNOSTIC_IMAGE base=0x%llx slide=0x%llx name=%s\n",
            (unsigned long long)(uintptr_t)_dyld_get_image_header(index),
            (unsigned long long)(uintptr_t)_dyld_get_image_vmaddr_slide(index), name);
  }
  fflush(stderr);
  struct sigaction action = {0};
  action.sa_sigaction = trace_segv;
  action.sa_flags = SA_SIGINFO;
  (void)sigemptyset(&action.sa_mask);
  (void)sigaction(SIGSEGV, &action, &original_segv);
}
#endif
