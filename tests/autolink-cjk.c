#include "autolink.h"
#include "resolver.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static void fallback(const char *source, const char *expected, bool cjk) {
  uint32_t starts[256], ends[256];
  uint32_t length = strlen(source);
  assert(length < 256);
  for (uint32_t i = 0; i < length; i++) {
    starts[i] = 100 + i;
    ends[i] = 101 + i;
  }
  Leaf leaf = {.text = (char *)source, .n = length,
               .starts = {starts, length, length}, .ends = {ends, length, length}};
  Words links = {0};
  autolinks(&leaf, 0, length, &links, cjk);
  assert(links.n == (expected ? 4 : 0));
  if (expected) {
    assert(links.v[0] == 100);
    assert(links.v[1] == 100 + strlen(expected));
    assert(links.v[2] == A);
  }
  free(links.v);
}

static void match_with_fallback(const char *source, const char *expected,
                                const char *expected_fallback, bool cjk) {
  size_t begin = 999, end = 999;
  size_t at = !strncmp(source, "www.", 4) ? 0 : 5;
  bool found = tsmd_gfm_autolink_match((const uint8_t *)source, strlen(source), at,
                                       &begin, &end, cjk);
  assert(found == (expected != NULL));
  fallback(source, expected_fallback, cjk);
  if (!expected) return;
  assert(begin == 0);
  assert(end == strlen(expected));
  assert(!memcmp(source, expected, end));
}

static void match(const char *source, const char *expected, bool cjk) {
  match_with_fallback(source, expected, expected, cjk);
}

static void prefixed_match(void) {
  const char *source = "前😀 https://例子.test.。後";
  const char *literal = "https://例子.test";
  size_t at = strstr(source, "://") - source;
  size_t begin = 0, end = 0;
  assert(tsmd_gfm_autolink_match((const uint8_t *)source, strlen(source), at, &begin, &end, true));
  assert(begin == strlen("前😀 "));
  assert(end == begin + strlen(literal));
  assert(!memcmp(source + begin, literal, end - begin));
}

void test_cjk_terminal_dots(void) {
  // The fallback counts the authored trailing dot, then trims it.
  match("https://dotless.。", "https://dotless", true);
  match_with_fallback("https://dotless。", "https://dotless", NULL, true);
  match("https://foo_bar.test.。", NULL, true);
  match("www.。", NULL, true);
  match("https://example.test.!。tail", "https://example.test", true);
  match("www.example.test.。tail", "www.example.test", true);
  // The fallback reads only ASCII hosts, like the reference.
  match_with_fallback("https://例子.test.。tail", "https://例子.test", NULL, true);
  match("https://example.test/a(b).。tail", "https://example.test/a(b)", true);
  match("https://foo_bar.example.test.。tail", "https://foo_bar.example.test", true);
  match("https://dotless.。", "https://dotless.。", false);
  match("https://foo_bar.test.。", "https://foo_bar.test.。", false);
  match("www.。", "www.。", false);
  prefixed_match();
  puts("CJK terminal-dot matcher and mapped fallback: 12 controls each; prefixed byte-range control passed");
}
