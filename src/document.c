#include "resolver.h"
// Document state for the inline pass. The block tree lives in web-tree-sitter;
// js/index.js walks it and describes each leaf block here as ranges.
#define CACHE_BUCKETS 16384

static void clear_entry(Cache *e) {
  for (uint32_t i = 0; i < e->deps.n; i++)
    free(e->deps.v[i]);
  free(e->deps.v);
  free(e->items.v);
  free(e);
}
static void clear_cache(Document *d) {
  for (uint32_t i = 0; i < CACHE_BUCKETS; i++) {
    Cache *e = d->cache[i];
    while (e) {
      Cache *next = e->next;
      clear_entry(e);
      e = next;
    }
    d->cache[i] = NULL;
  }
  d->cache_count = 0;
}
static void clear_sources(Document *d) {
  for (uint32_t i = 0; i < d->source_count; i++)
    cmark_reference_map_free(d->sources[i].map);
  d->source_count = 0;
}
static uint64_t mix(uint64_t h, uint64_t x) {
  return ((h << 5 | h >> 59) ^ x) * UINT64_C(0x517cc1b727220a95);
}
static uint64_t leaf_key(Document *d, uint32_t a, uint32_t b, const uint32_t *gaps,
                         uint32_t count, int kind) {
  uint64_t h = UINT64_C(0xcbf29ce484222325) ^ kind;
  uint32_t i = a;
  for (; i + 4 <= b; i += 4) {
    uint64_t x = (uint64_t)d->text[i] | (uint64_t)d->text[i + 1] << 16 |
                 (uint64_t)d->text[i + 2] << 32 | (uint64_t)d->text[i + 3] << 48;
    h = mix(h, x);
  }
  for (; i < b; i++)
    h = mix(h, d->text[i]);
  h = mix(h, b - a);
  for (uint32_t j = 0; j < count; j++)
    h = mix(h, (gaps[2 * j] - a) | (uint64_t)(gaps[2 * j + 1] - a) << 32);
  return h;
}
static void trim(Document *d, uint32_t *a, uint32_t *b) {
  while (*a < *b && ws(d->text[*a]))
    (*a)++;
  while (*b > *a && ws(d->text[*b - 1]))
    (*b)--;
}
static void cell(Words *cells, Document *d, uint32_t a, uint32_t b) {
  trim(d, &a, &b);
  word(cells, a);
  word(cells, b);
}
static void split_cells(Document *d, uint32_t a, uint32_t b, Words *cells) {
  cells->n = 0;
  while (a < b && ws(d->text[a]))
    a++;
  if (a < b && d->text[a] == '|')
    a++;
  uint32_t begin = a;
  while (a < b) {
    if (d->text[a] == '\\') {
      a += 2;
      continue;
    }
    if (d->text[a] == '|') {
      cell(cells, d, begin, a);
      begin = a + 1;
    }
    a++;
  }
  trim(d, &begin, &b);
  if (b > begin)
    cell(cells, d, begin, b);
}
static uint32_t table_cells(Document *d, Words *cells, bool delimiter, Words *out, Labels *deps) {
  uint32_t aligns = 0;
  for (uint32_t j = 0; j < cells->n; j += 2) {
    uint32_t a = cells->v[j], b = cells->v[j + 1];
    if (!delimiter) {
      leaf_single(d, a, b);
      inline_resolve(&d->leaf, ATX, d->gfm, d->defs, out, deps);
      continue;
    }
    bool left = d->text[a] == ':', right = b > a && d->text[b - 1] == ':';
    uint32_t bits = 0;
    if (left && right)
      bits = 2;
    else if (left)
      bits = 1;
    else if (right)
      bits = 3;
    if (j < 24)
      aligns |= bits << (8 + j);
  }
  return aligns;
}
// Rows of a pipe table, as the JS walk passes them: start, end, delimiter flag.
static void table(Document *d, const uint32_t *rows, uint32_t count, Words *out, Labels *deps,
                  uint32_t node_start) {
  uint32_t last = node_start, columns = 0, aligns = 0;
  Words cells = {0};
  uint32_t at = out->n;
  record(out, node_start, 0, TABLE, 0);
  for (uint32_t i = 0; i < count; i++) {
    const uint32_t *row = rows + 3 * i;
    last = row[1];
    split_cells(d, row[0], last, &cells);
    if (row[2])
      columns = cells.n / 2;
    aligns |= table_cells(d, &cells, row[2], out, deps);
  }
  while (last > node_start && (d->text[last - 1] == '\n' || d->text[last - 1] == '\r'))
    last--;
  out->v[at + 1] = last;
  out->v[at + 3] = (columns < 255 ? columns : 255) | aligns;
  free(cells.v);
}
// Reads a LeafShape from the argument words; returns the words it used.
static uint32_t read_shape(const uint32_t *args, LeafShape *shape) {
  shape->start = args[0];
  shape->end = args[1];
  shape->inline_start = args[2];
  shape->inline_end = args[3];
  shape->gap_count = args[4];
  shape->gaps = args + 5;
  return 5 + 2 * shape->gap_count;
}
static void insert_source(Document *d, uint32_t start, uint32_t end, cmark_reference_map *map) {
  uint32_t at = 0;
  while (at < d->source_count && d->sources[at].start < start)
    at++;
  if (at < d->source_count && d->sources[at].start == start) {
    cmark_reference_map_free(d->sources[at].map);
    d->sources[at] = (DefSource){start, end, map};
    return;
  }
  reserve((void **)&d->sources, &d->source_cap, d->source_count + 1, sizeof(DefSource));
  memmove(d->sources + at + 1, d->sources + at, (d->source_count - at) * sizeof(DefSource));
  d->sources[at] = (DefSource){start, end, map};
  d->source_count++;
}
static void remove_sources(Document *d, uint32_t from, uint32_t to) {
  uint32_t j = 0;
  for (uint32_t i = 0; i < d->source_count; i++) {
    DefSource s = d->sources[i];
    if (s.end < from || s.start > to)
      d->sources[j++] = s;
    else
      cmark_reference_map_free(s.map);
  }
  d->source_count = j;
}
static void copy_refs(cmark_reference_map *to, cmark_reference_map *from) {
  // Prepend in reverse so duplicate labels retain their original order.
  cmark_reference **refs = malloc(from->size * sizeof(*refs));
  uint32_t n = 0;
  for (cmark_reference *r = from->refs; r; r = r->next)
    refs[n++] = r;
  while (n) {
    cmark_reference *r = refs[--n], *c = calloc(1, sizeof(*c));
    c->label = (unsigned char *)strdup((char *)r->label);
    c->url = r->url ? (unsigned char *)strdup((char *)r->url) : NULL;
    c->title = r->title ? (unsigned char *)strdup((char *)r->title) : NULL;
    c->age = to->size++;
    c->next = to->refs;
    to->refs = c;
  }
  free(refs);
}
static bool same_ref(cmark_reference *a, cmark_reference *b) {
  if (!a || !b)
    return a == b;
  const char *au = a->url ? (char *)a->url : "", *bu = b->url ? (char *)b->url : "";
  const char *at = a->title ? (char *)a->title : "", *bt = b->title ? (char *)b->title : "";
  return !strcmp(au, bu) && !strcmp(at, bt);
}
static bool deps_changed(Cache *e, cmark_reference_map *a, cmark_reference_map *b) {
  for (uint32_t i = 0; i < e->deps.n; i++) {
    cmark_chunk label = {(unsigned char *)e->deps.v[i], strlen(e->deps.v[i])};
    if (!same_ref(cmark_reference_lookup(a, &label), cmark_reference_lookup(b, &label)))
      return true;
  }
  return false;
}
static bool refs_changed(cmark_reference_map *a, cmark_reference_map *b) {
  for (cmark_reference *r = a->refs; r; r = r->next) {
    cmark_chunk label = {r->label, strlen((char *)r->label)};
    if (!same_ref(cmark_reference_lookup(a, &label), cmark_reference_lookup(b, &label)))
      return true;
  }
  return false;
}
static void rebuild_defs(Document *d) {
  cmark_reference_map *next = cmark_reference_map_new(cmark_get_default_mem_allocator());
  for (uint32_t i = 0; i < d->source_count; i++)
    copy_refs(next, d->sources[i].map);
  bool sweep = d->cache_count >= 8192;
  bool changed = refs_changed(d->defs, next) || refs_changed(next, d->defs);
  if (!changed && !sweep) {
    cmark_reference_map_free(d->defs);
    d->defs = next;
    return;
  }
  for (uint32_t i = 0; i < CACHE_BUCKETS; i++) {
    Cache **p = &d->cache[i];
    while (*p) {
      Cache *e = *p;
      bool stale = sweep && d->epoch > 256 && e->used < d->epoch - 256;
      if (!stale && (!changed || !deps_changed(e, d->defs, next))) {
        p = &e->next;
        continue;
      }
      *p = e->next;
      clear_entry(e);
      d->cache_count--;
    }
  }
  cmark_reference_map_free(d->defs);
  d->defs = next;
}
static uint32_t upper(Words *v, uint32_t value) {
  uint32_t a = 0, b = v->n;
  while (a < b) {
    uint32_t m = a + (b - a) / 2;
    if (v->v[m] <= value)
      a = m + 1;
    else
      b = m;
  }
  return a;
}
Document *tsmd_new(uint32_t gfm) {
  Document *d = calloc(1, sizeof(*d));
  d->gfm = gfm;
  d->cache = calloc(CACHE_BUCKETS, sizeof(Cache *));
  d->defs = cmark_reference_map_new(cmark_get_default_mem_allocator());
  word(&d->lines, 0);
  return d;
}
void tsmd_free(Document *d) {
  if (!d)
    return;
  clear_cache(d);
  clear_sources(d);
  cmark_reference_map_free(d->defs);
  free(d->cache);
  free(d->sources);
  free(d->text);
  free(d->input);
  free(d->lines.v);
  free(d->out.v);
  free(d->spare.v);
  free(d->args.v);
  free(d->leaf.text);
  free(d->leaf.starts.v);
  free(d->leaf.ends.v);
  free(d);
}
uint16_t *tsmd_input(Document *d, uint32_t n) {
  reserve((void **)&d->input, &d->input_cap, n + 1, sizeof(uint16_t));
  d->input_len = n;
  return d->input;
}
uint32_t *tsmd_args(Document *d, uint32_t n) {
  reserve((void **)&d->args.v, &d->args.cap, n, sizeof(uint32_t));
  return d->args.v;
}
// Takes the input as the whole text. The caller then defines every paragraph
// that starts with a bracket and commits.
void tsmd_set_text(Document *d) {
  free(d->text);
  d->text = d->input;
  d->len = d->input_len;
  d->cap = d->input_cap;
  d->input = NULL;
  d->input_len = 0;
  d->input_cap = 0;
  d->lines.n = 0;
  word(&d->lines, 0);
  for (uint32_t i = 0; i < d->len; i++)
    if (d->text[i] == '\n')
      word(&d->lines, i + 1);
  clear_sources(d);
  clear_cache(d);
}
// Replaces [a, b) with the input. The caller then forgets the tree's changed
// ranges, defines the paragraphs in [a, a + input) and those ranges, and commits.
void tsmd_edit(Document *d, uint32_t a, uint32_t b) {
  uint32_t e = a + d->input_len;
  int64_t delta = (int64_t)e - b;
  reserve((void **)&d->text, &d->cap, d->len + delta + 1, sizeof(uint16_t));
  memmove(d->text + e, d->text + b, (d->len - b) * sizeof(uint16_t));
  memcpy(d->text + a, d->input, d->input_len * sizeof(uint16_t));
  d->len += delta;
  uint32_t la = upper(&d->lines, a), lb = upper(&d->lines, b), fresh = 0;
  for (uint32_t i = 0; i < d->input_len; i++)
    if (d->input[i] == '\n')
      fresh++;
  reserve((void **)&d->lines.v, &d->lines.cap, d->lines.n + fresh, sizeof(uint32_t));
  for (uint32_t i = lb; i < d->lines.n; i++)
    d->lines.v[i] += delta;
  memmove(d->lines.v + la + fresh, d->lines.v + lb, (d->lines.n - lb) * sizeof(uint32_t));
  d->lines.n += fresh - (lb - la);
  for (uint32_t i = 0; i < d->input_len; i++)
    if (d->input[i] == '\n')
      d->lines.v[la++] = a + i + 1;
  d->epoch++;
  remove_sources(d, a, b);
  for (uint32_t i = 0; i < d->source_count; i++) {
    if (d->sources[i].start > b) {
      d->sources[i].start += delta;
      d->sources[i].end += delta;
    }
  }
  remove_sources(d, a, e);
}
void tsmd_forget(Document *d, uint32_t a, uint32_t b) { remove_sources(d, a, b); }
// Args: a LeafShape for a paragraph whose inline text starts with '['.
void tsmd_define(Document *d) {
  LeafShape shape;
  read_shape(d->args.v, &shape);
  leaf_build(d, &shape, PARAGRAPH);
  cmark_reference_map *map = cmark_reference_map_new(cmark_get_default_mem_allocator());
  strip_definitions(&d->leaf, map, NULL);
  if (map->size)
    insert_source(d, shape.start, shape.end, map);
  else
    cmark_reference_map_free(map);
}
void tsmd_commit(Document *d) { rebuild_defs(d); }
void tsmd_reset(Document *d) { d->out.n = 0; }
void tsmd_record(Document *d, uint32_t a, uint32_t b, uint32_t kind, uint32_t extra) {
  record(&d->out, a, b, kind, extra);
}
// Args: block start, end, the block's continuation ranges for the cache key
// (count, then pairs), then a LeafShape, or for TABLE_LEAF a row count and rows.
void tsmd_leaf(Document *d, uint32_t kind) {
  const uint32_t *args = d->args.v;
  uint32_t base = args[0], stop = args[1], key_count = args[2];
  const uint32_t *rest = args + 3 + 2 * key_count;
  uint64_t key = leaf_key(d, base, stop, args + 3, key_count, kind);
  uint32_t bucket = key & (CACHE_BUCKETS - 1);
  Cache *e = d->cache[bucket];
  while (e && e->key != key)
    e = e->next;
  if (!e) {
    e = calloc(1, sizeof(*e));
    e->key = key;
    if (kind == TABLE_LEAF)
      table(d, rest + 1, rest[0], &e->items, &e->deps, base);
    else {
      LeafShape shape;
      read_shape(rest, &shape);
      leaf_build(d, &shape, kind);
      inline_resolve(&d->leaf, kind, d->gfm, d->defs, &e->items, &e->deps);
    }
    for (uint32_t i = 0; i < e->items.n; i += 4) {
      e->items.v[i] -= base;
      e->items.v[i + 1] -= base;
    }
    e->next = d->cache[bucket];
    d->cache[bucket] = e;
    d->cache_count++;
  }
  e->used = d->epoch;
  for (uint32_t i = 0; i < e->items.n; i += 4)
    record(&d->out, e->items.v[i] + base, e->items.v[i + 1] + base, e->items.v[i + 2],
           e->items.v[i + 3]);
}
uint32_t tsmd_highlights(Document *d) {
  highlights(d);
  return d->out.n;
}
uint32_t tsmd_count(Document *d) { return d->out.n; }
uint16_t *tsmd_text(Document *d) { return d->text; }
uint32_t tsmd_length(Document *d) { return d->len; }
uint32_t *tsmd_out(Document *d) { return d->out.v; }
uint32_t tsmd_row_start(Document *d, uint32_t row) {
  return row < d->lines.n ? d->lines.v[row] : d->len;
}
uint32_t tsmd_line_count(Document *d) { return d->lines.n; }
uint32_t tsmd_row_of(Document *d, uint32_t pos) { return upper(&d->lines, pos) - 1; }
