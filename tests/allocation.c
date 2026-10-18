#include "resolver.h"
#include <assert.h>
#include <stdio.h>

#if defined(__unix__) || defined(__APPLE__)
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

static bool fail_growth;
static void *allocate(void *pointer, size_t size) {
  if (fail_growth) return NULL;
  return realloc(pointer, size);
}

// Substitute the external allocator while exercising the production reserve guard.
#define realloc allocate
#include "../src/leaf.c"
#undef realloc

int main(void) {
  Words values = {0};
  word(&values, 7);
  assert(values.v[0] == 7);
  pid_t child = fork();
  assert(child >= 0);
  if (!child) {
    struct rlimit core = {0, 0};
    assert(setrlimit(RLIMIT_CORE, &core) == 0);
    fail_growth = true;
    reserve((void **)&values.v, &values.cap, values.cap + 1, sizeof(*values.v));
    _exit(1);
  }
  int status;
  assert(waitpid(child, &status, 0) == child);
  assert(WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT);
  assert(values.v[0] == 7);
  free(values.v);
  puts("Native allocation failure: production reserve abort verified in an owned child");
}
#else
int main(void) {
  puts("SKIP native allocation failure: fork and resource limits require a POSIX host");
}
#endif
