#include "resolver.h"
#include "utf8.h"

void reserve(void **p, uint32_t *cap, uint32_t n, size_t size) {
  if (n <= *cap)
    return;
  uint32_t next = *cap ? *cap * 2 : 16;
  if (next < n)
    next = n;
  *p = realloc(*p, next * size);
  if (!*p)
    abort();
  *cap = next;
}
void word(Words *v, uint32_t x) {
  reserve((void **)&v->v, &v->cap, v->n + 1, sizeof(*v->v));
  v->v[v->n++] = x;
}
void record(Words *v, uint32_t a, uint32_t b, uint32_t kind, uint32_t extra) {
  word(v, a);
  word(v, b);
  word(v, kind);
  word(v, extra);
}
static void leaf_clear(Leaf *l) {
  l->n = 0;
  l->starts.n = 0;
  l->ends.n = 0;
}
static void push_character(Leaf *l, uint32_t c, uint32_t a, uint32_t b) {
  uint8_t bytes[4];
  int n = 1;
  if (c < 0x80)
    bytes[0] = c;
  else if (c < 0x800) {
    n = 2;
    bytes[0] = 0xc0 | (c >> 6);
    bytes[1] = 0x80 | (c & 63);
  } else if (c < 0x10000) {
    n = 3;
    bytes[0] = 0xe0 | (c >> 12);
    bytes[1] = 0x80 | ((c >> 6) & 63);
    bytes[2] = 0x80 | (c & 63);
  } else {
    n = 4;
    bytes[0] = 0xf0 | (c >> 18);
    bytes[1] = 0x80 | ((c >> 12) & 63);
    bytes[2] = 0x80 | ((c >> 6) & 63);
    bytes[3] = 0x80 | (c & 63);
  }
  reserve((void **)&l->text, &l->cap, l->n + n + 1, 1);
  memcpy(l->text + l->n, bytes, n);
  l->n += n;
  l->text[l->n] = 0;
  for (int i = 0; i < n; i++) {
    word(&l->starts, a);
    word(&l->ends, b);
  }
}
static void push_lines(Document *d, uint32_t a, uint32_t b, bool *line_start) {
  while (a < b) {
    uint32_t c = d->text[a], n = 1;
    if (*line_start && (c == ' ' || c == '\t')) {
      a++;
      continue;
    }
    *line_start = false;
    if (c >= 0xd800 && c < 0xdc00 && a + 1 < b && d->text[a + 1] >= 0xdc00 &&
        d->text[a + 1] < 0xe000) {
      c = 0x10000 + ((c - 0xd800) << 10) + (d->text[a + 1] - 0xdc00);
      n = 2;
    }
    if (c >= 0xd800 && c < 0xe000)
      c = 0xfffd;
    if (!c)
      c = 0xfffd;
    push_character(&d->leaf, c, a, a + n);
    a += n;
    if (c == '\n')
      *line_start = true;
  }
}
void leaf_single(Document *d, uint32_t a, uint32_t b) {
  leaf_clear(&d->leaf);
  bool line_start = true;
  push_lines(d, a, b, &line_start);
  word(&d->leaf.starts, b);
}
void leaf_build(Document *d, TSNode node, int kind) {
  leaf_clear(&d->leaf);
  TSNode in = {0};
  uint32_t count = ts_node_named_child_count(node);
  for (uint32_t i = 0; i < count; i++) {
    TSNode c = ts_node_named_child(node, i);
    if (is(c, d->ids.inline_node)) {
      in = c;
      break;
    }
  }
  if (ts_node_is_null(in)) {
    word(&d->leaf.starts, end(node));
    return;
  }
  uint32_t a = start(in), b = end(in);
  if (kind == ATX) {
    while (a < b && ws(d->text[a]))
      a++;
    while (b > a && ws(d->text[b - 1]))
      b--;
    uint32_t h = b;
    while (h > a && d->text[h - 1] == '#')
      h--;
    if (h < b && (h == a || d->text[h - 1] == ' ' || d->text[h - 1] == '\t'))
      b = h;
    while (b > a && ws(d->text[b - 1]))
      b--;
    leaf_single(d, a, b);
    return;
  }
  bool line_start = true;
  count = ts_node_named_child_count(in);
  for (uint32_t i = 0; i < count; i++) {
    TSNode c = ts_node_named_child(in, i);
    if (!is(c, d->ids.block_continuation))
      continue;
    push_lines(d, a, start(c), &line_start);
    a = end(c);
  }
  push_lines(d, a, b, &line_start);
  word(&d->leaf.starts, b);
}
static void leaf_record(Leaf *l, Words *out, uint32_t a, uint32_t b, uint32_t kind) {
  if (a > b || b > l->n)
    abort();
  uint32_t s = l->starts.v[a], e = b ? l->ends.v[b - 1] : s;
  record(out, s, e < s ? s : e, kind, 0);
}
uint32_t strip_definitions(Leaf *l, cmark_reference_map *map, Words *records) {
  uint32_t pos = 0;
  while (pos < l->n && l->text[pos] == '[') {
    cmark_chunk chunk = {(unsigned char *)l->text + pos, l->n - pos};
    int n = cmark_parse_reference_inline(cmark_get_default_mem_allocator(), &chunk, map);
    if (!n)
      break;
    uint32_t b = pos + n;
    while (b > pos && ws(l->text[b - 1]))
      b--;
    if (records)
      leaf_record(l, records, pos, b, DEF);
    pos += n;
    while (pos < l->n && ws(l->text[pos]))
      pos++;
  }
  return pos;
}
static void dependency(void *ctx, const char *label) {
  Labels *labels = ctx;
  for (uint32_t i = 0; i < labels->n; i++)
    if (!strcmp(labels->v[i], label))
      return;
  reserve((void **)&labels->v, &labels->cap, labels->n + 1, sizeof(char *));
  labels->v[labels->n++] = strdup(label);
}
static cmark_node *text_run(Leaf *leaf, cmark_node *n, uint32_t offset, Words *out) {
  uint32_t a = n->source_start, b = n->source_end;
  while (n->next && n->next->type == CMARK_NODE_TEXT && n->next->source_start == b) {
    n = n->next;
    b = n->source_end;
  }
  autolinks(leaf, offset + a, offset + b, out);
  return n;
}
static void inline_nodes(Leaf *leaf, bool gfm, cmark_node *node, uint32_t offset, Words *out,
                         bool in_link) {
  for (cmark_node *n = node; n; n = n->next) {
    uint32_t kind = 0;
    switch (n->type) {
    case CMARK_NODE_EMPH:
      kind = EM;
      break;
    case CMARK_NODE_STRONG:
      kind = STRONG;
      break;
    case CMARK_NODE_STRIKETHROUGH:
      kind = DEL;
      break;
    case CMARK_NODE_CODE:
      kind = CSPAN;
      break;
    case CMARK_NODE_LINK:
      kind = A;
      break;
    case CMARK_NODE_IMAGE:
      kind = IMG;
      break;
    case CMARK_NODE_HTML_INLINE:
      kind = HTAG;
      break;
    case CMARK_NODE_LINEBREAK:
      kind = BR;
      break;
    }
    if (kind)
      leaf_record(leaf, out, offset + n->source_start, offset + n->source_end, kind);
    if (n->first_child)
      inline_nodes(leaf, gfm, n->first_child, offset, out, in_link || kind == A || kind == IMG);
    if ((kind == A || kind == IMG) && n->label_end > n->label_start)
      leaf_record(leaf, out, offset + n->label_start, offset + n->label_end, LINK_TEXT);
    if (gfm && !in_link && n->type == CMARK_NODE_TEXT)
      n = text_run(leaf, n, offset, out);
  }
}
void inline_resolve(Leaf *leaf, int kind, bool gfm, cmark_reference_map *defs, Words *out,
                    Labels *deps) {
  Leaf *l = leaf;
  if (!l->n)
    return;
  uint32_t body = 0;
  Words definitions = {0};
  if (kind == PARAGRAPH || kind == SETEXT) {
    cmark_reference_map *local = cmark_reference_map_new(cmark_get_default_mem_allocator());
    body = strip_definitions(l, local, &definitions);
    cmark_reference_map_free(local);
  }
  uint32_t b = l->n;
  while (b > body && ws(l->text[b - 1]))
    b--;
  if (kind == PARAGRAPH && b > body)
    leaf_record(l, out, body, b, P);
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)l->text + body;
  root->len = b - body;
  root->start_line = 1;
  root->start_column = 1;
  defs->lookup_label = dependency;
  defs->lookup_context = deps;
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, defs, gfm ? CMARK_OPT_GFM : 0);
  defs->lookup_label = NULL;
  defs->lookup_context = NULL;
  inline_nodes(leaf, gfm, root->first_child, body, out, false);
  root->data = NULL;
  root->len = 0;
  cmark_node_free(root);
  for (uint32_t i = 0; i < definitions.n; i++)
    word(out, definitions.v[i]);
  free(definitions.v);
}
