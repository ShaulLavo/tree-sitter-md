#ifndef TSMD_RESOLVER_H
#define TSMD_RESOLVER_H
#include "inlines.h"
#include "node.h"
#include "tree_sitter/api.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint32_t *v, n, cap;
} Words;
typedef struct {
  char **v;
  uint32_t n, cap;
} Labels;
typedef struct {
  char *text;
  uint32_t n, cap;
  Words starts, ends;
} Leaf;
typedef struct {
  uint32_t start, end;
  cmark_reference_map *map;
} DefSource;
typedef struct Cache {
  uint64_t key;
  uint32_t used;
  Words items;
  Labels deps;
  struct Cache *next;
} Cache;
#include "ids.h"
typedef struct {
  uint16_t *text, *input;
  uint32_t len, cap, input_len, input_cap;
  Words lines, out, spare;
  TSParser *parser;
  TSTree *tree;
  Ids ids;
  bool gfm, defs_dirty;
  Leaf leaf;
  DefSource *sources;
  uint32_t source_count, source_cap;
  cmark_reference_map *defs;
  Cache **cache;
  uint32_t cache_count, epoch;
} Document;
enum {
  P = 1,
  H,
  HR,
  CODE,
  BQ,
  LIST,
  LI,
  TASK,
  HBLOCK,
  DEF,
  TABLE,
  EM,
  STRONG,
  DEL,
  CSPAN,
  A,
  IMG,
  HTAG,
  BR,
  FRONTMATTER,
  HEADING_MARK = 32,
  LIST_MARK,
  QUOTE_MARK,
  FENCE_MARK,
  INFO,
  TASK_MARK,
  TABLE_DELIMITER_ROW,
  LINK_TEXT
};
enum { PARAGRAPH, SETEXT, ATX, TABLE_LEAF };
void reserve(void **p, uint32_t *cap, uint32_t n, size_t size);
void word(Words *v, uint32_t x);
void record(Words *v, uint32_t a, uint32_t b, uint32_t kind, uint32_t extra);
void leaf_build(Document *d, TSNode node, int kind);
void leaf_single(Document *d, uint32_t a, uint32_t b);
uint32_t strip_definitions(Leaf *leaf, cmark_reference_map *map, Words *records);
void inline_resolve(Leaf *leaf, int kind, bool gfm, cmark_reference_map *defs, Words *out,
                    Labels *deps);
void autolinks(Leaf *leaf, uint32_t a, uint32_t b, Words *out);
void highlights(Document *d);
static inline uint32_t start(TSNode n) { return ts_node_start_byte(n) / 2; }
static inline uint32_t end(TSNode n) { return ts_node_end_byte(n) / 2; }
static inline bool ws(uint16_t c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }
static inline bool is(TSNode n, uint16_t id) {
  return !ts_node_is_null(n) && ts_node_symbol(n) == id;
}
#endif
