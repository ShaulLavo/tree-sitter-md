// The parser has no process or I/O services. Diagnostics fail closed in wasm.
#ifdef __wasm__
#include <stddef.h>
#include <stdint.h>
__attribute__((noreturn)) void __wrap___wasi_proc_exit(uint32_t code) {
  (void)code;
  __builtin_trap();
}
uint16_t __wrap___wasi_fd_close(uint32_t fd) {
  (void)fd;
  return 8;
}
uint16_t __wrap___wasi_fd_seek(uint32_t fd, int64_t off, uint8_t whence, uint64_t *pos) {
  (void)fd;
  (void)off;
  (void)whence;
  (void)pos;
  return 8;
}
uint16_t __wrap___wasi_fd_write(uint32_t fd, const void *iov, size_t n, size_t *written) {
  (void)fd;
  (void)iov;
  (void)n;
  *written = 0;
  return 8;
}
uint16_t __wrap___wasi_random_get(void *buf, size_t n) {
  (void)buf;
  (void)n;
  return 52;
}
uint16_t __wrap___wasi_args_get(void *argv, void *buf) {
  (void)argv;
  (void)buf;
  return 0;
}
uint16_t __wrap___wasi_args_sizes_get(size_t *n, size_t *size) {
  *n = 0;
  *size = 0;
  return 0;
}
#endif
