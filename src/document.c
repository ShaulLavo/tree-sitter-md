#include "resolver.h"
extern const TSLanguage *tree_sitter_markdown(void);
#define CACHE_BUCKETS 16384

static TSNode child(TSNode node, uint16_t id) {
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
    TSNode c = ts_node_named_child(node, i);
    if (is(c, id))
      return c;
  }
  return (TSNode){0};
}
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
static uint64_t layout_key(Document *d, TSNode node, uint32_t base, uint64_t h) {
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
    TSNode c = ts_node_named_child(node, i);
    if (is(c, d->ids.block_continuation))
      h = mix(h, (start(c) - base) | (uint64_t)(end(c) - base) << 32);
    else if (ts_node_named_child_count(c))
      h = layout_key(d, c, base, h);
  }
  return h;
}
static uint64_t leaf_key(Document *d, TSNode node, int kind) {
  uint32_t a = start(node), b = end(node), i = a;
  uint64_t h = UINT64_C(0xcbf29ce484222325) ^ kind;
  for (; i + 4 <= b; i += 4) {
    uint64_t x = (uint64_t)d->text[i] | (uint64_t)d->text[i + 1] << 16 |
                 (uint64_t)d->text[i + 2] << 32 | (uint64_t)d->text[i + 3] << 48;
    h = mix(h, x);
  }
  for (; i < b; i++)
    h = mix(h, d->text[i]);
  return layout_key(d, node, a, mix(h, b - a));
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
static void table(Document *d, TSNode node, Words *out, Labels *deps) {
  uint32_t last = start(node), columns = 0, aligns = 0;
  Words cells = {0};
  uint32_t at = out->n;
  record(out, start(node), 0, TABLE, 0);
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
    TSNode row = ts_node_named_child(node, i);
    if (is(row, d->ids.block_continuation))
      continue;
    last = end(row);
    split_cells(d, start(row), last, &cells);
    bool delimiter = is(row, d->ids.pipe_table_delimiter_row);
    if (delimiter)
      columns = cells.n / 2;
    aligns |= table_cells(d, &cells, delimiter, out, deps);
  }
  while (last > start(node) && (d->text[last - 1] == '\n' || d->text[last - 1] == '\r'))
    last--;
  out->v[at + 1] = last;
  out->v[at + 3] = (columns < 255 ? columns : 255) | aligns;
  free(cells.v);
}
static void resolve_leaf(Document *d, TSNode node, int kind) {
  uint64_t key = leaf_key(d, node, kind);
  uint32_t bucket = key & (CACHE_BUCKETS - 1), base = start(node);
  Cache *e = d->cache[bucket];
  while (e && e->key != key)
    e = e->next;
  if (!e) {
    e = calloc(1, sizeof(*e));
    e->key = key;
    if (kind == TABLE_LEAF)
      table(d, node, &e->items, &e->deps);
    else {
      leaf_build(d, node, kind);
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
static bool has_leaves(Document *d, TSNode n) {
  Ids *i = &d->ids;
  uint16_t id = ts_node_symbol(n);
  return id != i->fenced_code_block && id != i->indented_code_block && id != i->html_block &&
         id != i->pipe_table && id != i->atx_heading && id != i->thematic_break &&
         id != i->inline_node;
}
static void insert_source(Document *d, TSNode n, cmark_reference_map *map) {
  uint32_t at = 0;
  while (at < d->source_count && d->sources[at].start < start(n))
    at++;
  if (at < d->source_count && d->sources[at].start == start(n)) {
    cmark_reference_map_free(d->sources[at].map);
    d->sources[at] = (DefSource){start(n), end(n), map};
    return;
  }
  reserve((void **)&d->sources, &d->source_cap, d->source_count + 1, sizeof(DefSource));
  memmove(d->sources + at + 1, d->sources + at, (d->source_count - at) * sizeof(DefSource));
  d->sources[at] = (DefSource){start(n), end(n), map};
  d->source_count++;
}
static void scan_definitions(Document *d, TSTreeCursor *cursor, uint32_t from, uint32_t to) {
  TSNode n = ts_tree_cursor_current_node(cursor);
  if (is(n, d->ids.paragraph)) {
    TSNode in = child(n, d->ids.inline_node);
    uint32_t a = start(in);
    if (ts_node_is_null(in))
      return;
    while (a < d->len && (d->text[a] == ' ' || d->text[a] == '\t'))
      a++;
    if (a >= d->len || d->text[a] != '[')
      return;
    leaf_build(d, n, PARAGRAPH);
    cmark_reference_map *map = cmark_reference_map_new(cmark_get_default_mem_allocator());
    strip_definitions(&d->leaf, map, NULL);
    if (map->size)
      insert_source(d, n, map);
    else
      cmark_reference_map_free(map);
    return;
  }
  if (!has_leaves(d, n) || ts_tree_cursor_goto_first_child_for_byte(cursor, from * 2) < 0)
    return;
  do {
    if (start(ts_tree_cursor_current_node(cursor)) > to)
      break;
    scan_definitions(d, cursor, from, to);
  } while (ts_tree_cursor_goto_next_sibling(cursor));
  ts_tree_cursor_goto_parent(cursor);
}
static void scan_range(Document *d, uint32_t from, uint32_t to) {
  TSTreeCursor cursor = ts_tree_cursor_new(ts_tree_root_node(d->tree));
  scan_definitions(d, &cursor, from, to);
  ts_tree_cursor_delete(&cursor);
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
static uint32_t emit_setext_marks(Document *d, TSNode n) {
  uint32_t level = 2;
  for (uint32_t j = 0; j < ts_node_named_child_count(n); j++) {
    TSNode c = ts_node_named_child(n, j);
    if (is(c, d->ids.setext_h1))
      level = 1;
    if (!is(c, d->ids.paragraph) && !is(c, d->ids.block_continuation))
      record(&d->out, start(c), end(c), HEADING_MARK, level);
  }
  return level;
}
static void emit_fence_marks(Document *d, TSNode n) {
  for (uint32_t j = 0; j < ts_node_named_child_count(n); j++) {
    TSNode c = ts_node_named_child(n, j);
    if (is(c, d->ids.info_string))
      record(&d->out, start(c), end(c), INFO, 0);
    if (is(c, d->ids.fence_delimiter))
      record(&d->out, start(c), end(c), FENCE_MARK, 0);
  }
}
static bool emit(Document *d, TSNode n) {
  Ids *i = &d->ids;
  uint16_t id = ts_node_symbol(n);
  uint32_t s = start(n), e = end(n);
  if (id == i->paragraph) {
    resolve_leaf(d, n, is(ts_node_parent(n), i->setext_heading) ? SETEXT : PARAGRAPH);
    return false;
  }
  if (id == i->atx_heading) {
    TSNode marker = ts_node_named_child(n, 0);
    uint32_t level = 1;
    for (uint32_t j = 0; j < 6; j++)
      if (is(marker, i->atx_markers[j]))
        level = j + 1;
    record(&d->out, s, e, H, level);
    if (!ts_node_is_null(marker))
      record(&d->out, start(marker), end(marker), HEADING_MARK, level);
    resolve_leaf(d, n, ATX);
    return false;
  }
  if (id == i->setext_heading) {
    uint32_t level = emit_setext_marks(d, n);
    record(&d->out, s, e, H, level);
    return true;
  }
  if (id == i->pipe_table) {
    TSNode delim = child(n, i->pipe_table_delimiter_row);
    if (!ts_node_is_null(delim))
      record(&d->out, start(delim), end(delim), TABLE_DELIMITER_ROW, 0);
    resolve_leaf(d, n, TABLE_LEAF);
    return false;
  }
  if (id == i->fenced_code_block) {
    record(&d->out, s, e, CODE, 1);
    emit_fence_marks(d, n);
    return false;
  }
  if (id == i->indented_code_block) {
    record(&d->out, s, e, CODE, 0);
    return false;
  }
  if (id == i->html_block) {
    record(&d->out, s, e, HBLOCK, 0);
    return false;
  }
  if (id == i->thematic_break) {
    record(&d->out, s, e, HR, 0);
    return false;
  }
  if (id == i->minus_metadata || id == i->plus_metadata) {
    record(&d->out, s, e, FRONTMATTER, 0);
    return false;
  }
  if (id == i->block_quote) {
    record(&d->out, s, e, BQ, 0);
    return true;
  }
  if (id == i->block_quote_marker) {
    record(&d->out, s, e, QUOTE_MARK, 0);
    return false;
  }
  if (id == i->list) {
    TSNode marker = ts_node_named_child(ts_node_named_child(n, 0), 0);
    record(&d->out, s, e, LIST, is(marker, i->marker_dot) || is(marker, i->marker_paren));
    return true;
  }
  if (id == i->list_item) {
    record(&d->out, s, e, LI, 0);
    return true;
  }
  for (uint32_t j = 0; j < 5; j++)
    if (id == i->list_markers[j]) {
      record(&d->out, s, e, LIST_MARK, 0);
      return false;
    }
  if (id == i->task_checked || id == i->task_unchecked) {
    record(&d->out, s, e, TASK, id == i->task_checked);
    return false;
  }
  return true;
}
static bool fold(Document *d, TSNode n) {
  const char *kind = ts_node_type(n);
  uint32_t a = start(n), b = end(n);
  trim(d, &a, &b);
  bool foldable = !strcmp(kind, "section") || is(n, d->ids.fenced_code_block) ||
                  is(n, d->ids.block_quote) || is(n, d->ids.list_item) ||
                  is(n, d->ids.pipe_table) || is(n, d->ids.html_block);
  for (uint32_t j = a; foldable && j < b; j++) {
    if (d->text[j] == '\n') {
      word(&d->out, a);
      word(&d->out, b);
      break;
    }
  }
  return !is(n, d->ids.paragraph) && !is(n, d->ids.fenced_code_block) &&
         !is(n, d->ids.html_block) && !is(n, d->ids.pipe_table) &&
         !is(n, d->ids.indented_code_block);
}
static bool injection(Document *d, TSNode n) {
  if (!is(n, d->ids.fenced_code_block))
    return has_leaves(d, n);
  TSNode info = child(n, d->ids.info_string), content = child(n, d->ids.code_fence_content);
  uint32_t a = 0, b = 0;
  if (!ts_node_is_null(info)) {
    a = start(info);
    uint32_t e = end(info);
    while (a < e && (d->text[a] == ' ' || d->text[a] == '\t'))
      a++;
    b = a;
    while (b < e && !ws(d->text[b]))
      b++;
  }
  if (!ts_node_is_null(content))
    record(&d->out, start(content), end(content), a, b);
  return false;
}
static void visit(Document *d, TSTreeCursor *c, uint32_t from, uint32_t to, int mode) {
  TSNode n = ts_tree_cursor_current_node(c);
  bool descend;
  if (mode == 1)
    descend = fold(d, n);
  else if (mode == 2)
    descend = injection(d, n);
  else
    descend = emit(d, n);
  if (!descend || ts_tree_cursor_goto_first_child_for_byte(c, from * 2) < 0)
    return;
  do {
    TSNode ch = ts_tree_cursor_current_node(c);
    if (start(ch) >= to && (mode || end(ch) > start(ch)))
      break;
    visit(d, c, from, to, mode);
  } while (ts_tree_cursor_goto_next_sibling(c));
  ts_tree_cursor_goto_parent(c);
}
static uint32_t output(Document *d, uint32_t from, uint32_t to, int mode) {
  d->out.n = 0;
  if (!d->tree)
    return 0;
  TSTreeCursor c = ts_tree_cursor_new(ts_tree_root_node(d->tree));
  visit(d, &c, from, to, mode);
  ts_tree_cursor_delete(&c);
  return d->out.n;
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
static TSPoint point(Document *d, uint32_t pos) {
  uint32_t row = upper(&d->lines, pos) - 1;
  return (TSPoint){row, (pos - d->lines.v[row]) * 2};
}
static TSTree *parse(Document *d, TSTree *old) {
  return ts_parser_parse_string_encoding(d->parser, old, (char *)d->text, d->len * 2,
                                         TSInputEncodingUTF16LE);
}
Document *tsmd_new(uint32_t gfm) {
  Document *d = calloc(1, sizeof(*d));
  d->parser = ts_parser_new();
  ts_parser_set_language(d->parser, tree_sitter_markdown());
  d->ids = make_ids(tree_sitter_markdown());
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
  ts_tree_delete(d->tree);
  ts_parser_delete(d->parser);
  free(d->cache);
  free(d->sources);
  free(d->text);
  free(d->input);
  free(d->lines.v);
  free(d->out.v);
  free(d->spare.v);
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
  ts_tree_delete(d->tree);
  d->tree = parse(d, NULL);
  scan_range(d, 0, d->len);
  rebuild_defs(d);
}
void tsmd_reparse(Document *d) {
  if (!d->tree)
    return;
  TSTree *old = d->tree;
  d->tree = parse(d, old);
  ts_tree_delete(old);
}
void tsmd_edit(Document *d, uint32_t a, uint32_t b) {
  uint32_t e = a + d->input_len;
  int64_t delta = (int64_t)e - b;
  TSInputEdit edit = {.start_byte = a * 2,
                      .old_end_byte = b * 2,
                      .new_end_byte = e * 2,
                      .start_point = point(d, a),
                      .old_end_point = point(d, b)};
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
  edit.new_end_point = point(d, e);
  TSTree *old = d->tree;
  ts_tree_edit(old, &edit);
  d->tree = parse(d, old);
  uint32_t count = 0;
  TSRange *ranges = ts_tree_get_changed_ranges(old, d->tree, &count);
  ts_tree_delete(old);
  d->epoch++;
  remove_sources(d, a, b);
  for (uint32_t i = 0; i < d->source_count; i++) {
    if (d->sources[i].start > b) {
      d->sources[i].start += delta;
      d->sources[i].end += delta;
    }
  }
  remove_sources(d, a, e);
  for (uint32_t i = 0; i < count; i++)
    remove_sources(d, ranges[i].start_byte / 2, ranges[i].end_byte / 2);
  scan_range(d, a, e);
  for (uint32_t i = 0; i < count; i++)
    scan_range(d, ranges[i].start_byte / 2, ranges[i].end_byte / 2);
  free(ranges);
  rebuild_defs(d);
}
uint32_t tsmd_decorations(Document *d, uint32_t a, uint32_t b) { return output(d, a, b, 0); }
uint32_t tsmd_folds(Document *d, uint32_t a, uint32_t b) { return output(d, a, b, 1); }
uint32_t tsmd_injections(Document *d, uint32_t a, uint32_t b) { return output(d, a, b, 2); }
uint32_t tsmd_highlights(Document *d, uint32_t a, uint32_t b) {
  output(d, a, b, 0);
  highlights(d);
  return d->out.n;
}
uint32_t *tsmd_out(Document *d) { return d->out.v; }
uint32_t tsmd_row_start(Document *d, uint32_t row) {
  return row < d->lines.n ? d->lines.v[row] : d->len;
}
uint32_t tsmd_line_count(Document *d) { return d->lines.n; }
