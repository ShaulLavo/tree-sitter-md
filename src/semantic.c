#include "resolver.h"
#include "houdini.h"
#include "utf8.h"
#include "footnote.h"
#include <strings.h>

typedef struct {
  Document *d;
  cmark_strbuf json;
  uint32_t skip_until;
  Footnotes *footnotes;
  Footnotes *root_footnotes;
  cmark_reference_map *defs;
} Semantic;

static void put(Semantic *s, const char *text) { cmark_strbuf_puts(&s->json, text); }
static void number(Semantic *s, uint32_t n) {
  char digits[10]; uint32_t count = 0;
  do { digits[count++] = '0' + n % 10; n /= 10; } while (n);
  while (count) cmark_strbuf_putc(&s->json, digits[--count]);
}
static void string(Semantic *s, const unsigned char *text, uint32_t len) {
  static const char hex[] = "0123456789abcdef";
  put(s, "\"");
  for (uint32_t i = 0; i < len; i++) {
    unsigned char c = text[i];
    if (c == '"' || c == '\\') {
      cmark_strbuf_putc(&s->json, '\\');
      cmark_strbuf_putc(&s->json, c);
      continue;
    }
    if (c >= 32) {
      cmark_strbuf_putc(&s->json, c);
      continue;
    }
    char escape[] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 15], 0};
    put(s, escape);
  }
  put(s, "\"");
}
static void nullable_string(Semantic *s, const unsigned char *text) {
  if (!text || !*text) { put(s, "null"); return; }
  string(s, text, strlen((char *)text));
}
static void range(Semantic *s, uint32_t a, uint32_t b) {
  if (!footnotes_map_range(s->footnotes, a, b, &a, &b)) abort();
  put(s, "\"range\":{\"start\":"); number(s, a);
  put(s, ",\"end\":"); number(s, b); put(s, "}");
}
static void begin(Semantic *s, const char *type, uint32_t a, uint32_t b) {
  put(s, "{\"type\":\""); put(s, type); put(s, "\","); range(s, a, b);
}
static void separator(Semantic *s, bool *first) {
  if (!*first) put(s, ",");
  *first = false;
}
static uint32_t mapped_start(Leaf *l, uint32_t at) { return l->starts.v[at]; }
static uint32_t mapped_end(Leaf *l, uint32_t at) {
  return at ? l->ends.v[at - 1] : l->starts.v[0];
}
static TSNode find_child(Document *d, TSNode n, uint16_t id) {
  (void)d;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode c = ts_node_named_child(n, i);
    if (is(c, id)) return c;
  }
  return (TSNode){0};
}
static uint32_t content_end(Document *d, TSNode n) {
  uint32_t b = end(n);
  while (b > start(n) && ws(d->text[b - 1])) b--;
  for (uint32_t i = ts_node_named_child_count(n); i > 0; i--) {
    TSNode c = ts_node_named_child(n, i - 1);
    if (end(c) < b) break;
    if (is(c, d->ids.block_continuation)) { b = start(c); continue; }
    b = content_end(d, c);
    break;
  }
  while (b > start(n) && ws(d->text[b - 1])) b--;
  return b;
}
static void inline_children(Semantic *, Leaf *, cmark_node *, uint32_t, bool);

static void inline_range(Leaf *l, cmark_node *n, uint32_t offset, uint32_t *a, uint32_t *b) {
  *a = mapped_start(l, offset + n->source_start);
  *b = mapped_end(l, offset + n->source_end);
  if (*b < *a) *b = *a;
}
static void text_value(Semantic *s, uint32_t a, uint32_t b, const unsigned char *data, uint32_t len) {
  begin(s, "text", a, b); put(s, ",\"value\":"); string(s, data, len); put(s, "}");
}
static void alt_text(cmark_strbuf *out, cmark_node *n) {
  for (; n; n = n->next) {
    if (n->type == CMARK_NODE_TEXT || n->type == CMARK_NODE_CODE)
      cmark_strbuf_put(out, n->data, n->len);
    if (n->type == CMARK_NODE_SOFTBREAK || n->type == CMARK_NODE_LINEBREAK)
      cmark_strbuf_putc(out, '\n');
    if (n->first_child) alt_text(out, n->first_child);
  }
}
static const char *inline_type(cmark_node *n) {
  switch (n->type) {
  case CMARK_NODE_TEXT: return "text";
  case CMARK_NODE_CODE: return "code";
  case CMARK_NODE_INLINE_MATH: return "math";
  case CMARK_NODE_FOOTNOTE_REFERENCE: return "footnoteReference";
  case CMARK_NODE_HTML_INLINE: return "html";
  case CMARK_NODE_EMPH: return "emphasis";
  case CMARK_NODE_STRONG: return "strong";
  case CMARK_NODE_STRIKETHROUGH: return "delete";
  case CMARK_NODE_LINK: return "link";
  case CMARK_NODE_IMAGE: return "image";
  case CMARK_NODE_LINEBREAK: case CMARK_NODE_SOFTBREAK: return "break";
  default: abort();
  }
}
static void inline_node(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset, bool in_link) {
  uint32_t a, b;
  inline_range(l, n, offset, &a, &b);
  begin(s, inline_type(n), a, b);
  if (n->type == CMARK_NODE_FOOTNOTE_REFERENCE) {
    put(s, ",\"identifier\":"); string(s, n->data, n->len); put(s, "}"); return;
  }
  if (n->type == CMARK_NODE_SOFTBREAK || n->type == CMARK_NODE_LINEBREAK) {
    put(s, n->type == CMARK_NODE_LINEBREAK ? ",\"hard\":true}" : ",\"hard\":false}");
    return;
  }
  if (n->type == CMARK_NODE_TEXT || n->type == CMARK_NODE_CODE || n->type == CMARK_NODE_INLINE_MATH || n->type == CMARK_NODE_HTML_INLINE) {
    put(s, ",\"value\":"); string(s, n->data, n->len); put(s, "}");
    return;
  }
  if (n->type == CMARK_NODE_LINK || n->type == CMARK_NODE_IMAGE) {
    put(s, ",\"url\":"); string(s, n->as.link.url, strlen((char *)n->as.link.url));
    put(s, ",\"title\":"); nullable_string(s, n->as.link.title);
  }
  if (n->type == CMARK_NODE_IMAGE) {
    cmark_strbuf alt = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
    alt_text(&alt, n->first_child);
    put(s, ",\"alt\":"); string(s, alt.ptr, alt.size); cmark_strbuf_free(&alt); put(s, "}");
    return;
  }
  put(s, ",\"children\":[");
  inline_children(s, l, n->first_child, offset, in_link || n->type == CMARK_NODE_LINK);
  put(s, "]}");
}
static uint32_t leaf_byte(Leaf *l, uint32_t position, uint32_t from, uint32_t to) {
  while (from < to && l->starts.v[from] < position) from++;
  return from;
}
static uint32_t cjk_link_end(Leaf *l, uint32_t a, uint32_t b) {
  for (uint32_t i = a; i < b;) {
    int32_t c = 0; int width = cmark_utf8proc_iterate((unsigned char *)l->text + i, b - i, &c);
    if (width <= 0) break;
    if (c == 0x3002 || c == 0xff0e || c == 0xff0c || c == 0x3001 || c == 0xff1f || c == 0xff01 ||
        c == 0xff1a || c == 0xff1b || c == 0xff08 || c == 0xff09 || c == 0x3010 || c == 0x3011 ||
        c == 0x300c || c == 0x300d || c == 0x300e || c == 0x300f || c == 0x3008 || c == 0x3009 ||
        c == 0x300a || c == 0x300b) return i;
    i += width;
  }
  return b;
}
static void decoded_part(cmark_strbuf *out, Leaf *l, cmark_node *first, cmark_node *last,
                         uint32_t a, uint32_t b) {
  for (cmark_node *n = first; n; n = n->next) {
    uint32_t low = a > (uint32_t)n->source_start ? a : (uint32_t)n->source_start;
    uint32_t high = b < (uint32_t)n->source_end ? b : (uint32_t)n->source_end;
    if (low < high && low == (uint32_t)n->source_start && high == (uint32_t)n->source_end)
      cmark_strbuf_put(out, n->data, n->len);
    else if (low < high) {
      cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
      houdini_unescape_html_f(&value, (unsigned char *)l->text + low, high - low);
      cmark_strbuf_unescape(&value);
      cmark_strbuf_put(out, value.ptr, value.size); cmark_strbuf_free(&value);
    }
    if (n == last) break;
  }
}
static void text_part(Semantic *s, Leaf *l, cmark_node *first, cmark_node *last,
                      uint32_t offset, uint32_t a, uint32_t b, bool link, bool *first_out) {
  if (a >= b) return;
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  // Nodes use body-relative bytes; leaf mappings include the stripped definitions.
  Leaf body = *l; body.text += offset;
  decoded_part(&value, &body, first, last, a, b);
  separator(s, first_out);
  uint32_t start_pos = mapped_start(l, offset + a), end_pos = mapped_end(l, offset + b);
  if (!link) {
    text_value(s, start_pos, end_pos, value.ptr, value.size);
    cmark_strbuf_free(&value); return;
  }
  begin(s, "link", start_pos, end_pos); put(s, ",\"url\":");
  cmark_strbuf url = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  if (value.size >= 4 && !strncasecmp((char *)value.ptr, "www.", 4)) cmark_strbuf_puts(&url, "http://");
  if (memchr(value.ptr, '@', value.size) && !memchr(value.ptr, ':', value.size)) cmark_strbuf_puts(&url, "mailto:");
  cmark_strbuf_put(&url, value.ptr, value.size); string(s, url.ptr, url.size);
  put(s, ",\"title\":null,\"children\":["); text_value(s, start_pos, end_pos, value.ptr, value.size); put(s, "]}");
  cmark_strbuf_free(&url); cmark_strbuf_free(&value);
}
static cmark_node *text_nodes(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset, bool *first) {
  cmark_node *last = n;
  while (last->next && last->next->type == CMARK_NODE_TEXT && last->source_end == last->next->source_start)
    last = last->next;
  uint32_t a = n->source_start, b = last->source_end, at = a;
  Words links = {0}; autolinks(l, offset + a, offset + b, &links);
  for (uint32_t i = 0; i < links.n; i += 4) {
    uint32_t x = leaf_byte(l, links.v[i], offset + at, offset + b) - offset;
    uint32_t y = x;
    while (offset + y < l->n && l->ends.v[offset + y] <= links.v[i + 1]) y++;
    if (s->d->cjk) y = cjk_link_end(l, offset + x, offset + y) - offset;
    text_part(s, l, n, last, offset, at, x, false, first);
    text_part(s, l, n, last, offset, x, y, true, first); at = y;
  }
  text_part(s, l, n, last, offset, at, b, false, first);
  free(links.v); return last;
}
static void inline_children(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset, bool in_link) {
  bool first = true;
  for (; n; n = n->next) {
    if (n->type == CMARK_NODE_TEXT && !n->len) continue;
    if (s->d->gfm && !in_link && n->type == CMARK_NODE_TEXT) {
      n = text_nodes(s, l, n, offset, &first); continue;
    }
    separator(s, &first); inline_node(s, l, n, offset, in_link);
  }
}
static const char *lookup_footnote(void *context, const unsigned char *label, uint32_t length) {
  const Footnote *note = footnotes_lookup(context, label, length);
  return note ? note->identifier : NULL;
}
static void parse_inlines(Semantic *s, Leaf *l, uint32_t body) {
  uint32_t b = l->n;
  while (b > body && ws(l->text[b - 1])) b--;
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)l->text + body; root->len = b - body;
  root->start_line = 1; root->start_column = 1;
  s->defs->lookup_footnote = lookup_footnote; s->defs->footnote_context = s->root_footnotes;
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, s->defs,
                      (s->d->gfm ? CMARK_OPT_GFM : 0) | (s->d->cjk ? CMARK_OPT_CJK : 0) |
                        (s->d->math ? CMARK_OPT_MATH : 0) | (s->d->gfm ? CMARK_OPT_FOOTNOTES : 0));
  s->defs->lookup_footnote = NULL; s->defs->footnote_context = NULL;
  inline_children(s, l, root->first_child, body, false);
  root->data = NULL; root->len = 0; cmark_node_free(root);
}
static uint32_t definitions(Semantic *s, Leaf *l, bool *first) {
  uint32_t pos = 0;
  while (pos < l->n && l->text[pos] == '[') {
    cmark_reference_map *map = cmark_reference_map_new(cmark_get_default_mem_allocator());
    cmark_chunk chunk = {(unsigned char *)l->text + pos, l->n - pos};
    int count = cmark_parse_reference_inline(cmark_get_default_mem_allocator(), &chunk, map);
    if (!count) { cmark_reference_map_free(map); break; }
    uint32_t b = pos + count;
    while (b > pos && ws(l->text[b - 1])) b--;
    cmark_reference *ref = map->refs;
    separator(s, first); begin(s, "definition", mapped_start(l, pos), mapped_end(l, b));
    put(s, ",\"identifier\":"); string(s, ref->label, strlen((char *)ref->label));
    put(s, ",\"url\":"); string(s, ref->url, strlen((char *)ref->url));
    put(s, ",\"title\":"); nullable_string(s, ref->title); put(s, "}");
    cmark_reference_map_free(map); pos += count;
    while (pos < l->n && ws(l->text[pos])) pos++;
  }
  return pos;
}
static void block_children(Semantic *, TSNode, bool *);
static void footnote_definition(Semantic *s, const Footnote *note, bool *first) {
  separator(s, first); begin(s, "footnoteDefinition", note->start, note->end);
  put(s, ",\"identifier\":"); string(s, (unsigned char *)note->identifier, note->identifier_len);
  put(s, ",\"children\":[");
  Document *document = s->d; Footnotes *notes = s->footnotes; uint32_t skip = s->skip_until;
  s->d = note->body; s->footnotes = note->nested; s->skip_until = 0;
  bool child_first = true; block_children(s, ts_tree_root_node(note->body->tree), &child_first);
  s->d = document; s->footnotes = notes; s->skip_until = skip;
  put(s, "]}");
}
static void paragraph_part(Semantic *s, Leaf *l, uint32_t a, uint32_t limit, bool *first) {
  Leaf part = *l; part.text += a; part.n = limit - a; part.starts.v += a; part.ends.v += a;
  l = &part;
  uint32_t body = definitions(s, l, first), b = l->n;
  while (b > body && ws(l->text[b - 1])) b--;
  if (body == b) return;
  separator(s, first); begin(s, "paragraph", mapped_start(l, body), mapped_end(l, b));
  put(s, ",\"children\":["); parse_inlines(s, l, body); put(s, "]}");
}
static void paragraph(Semantic *s, TSNode n, bool *first) {
  leaf_build(s->d, n, PARAGRAPH); Leaf *l = &s->d->leaf; uint32_t from = 0;
  from = leaf_byte(l, s->skip_until, 0, l->n);
  for (uint32_t i = 0; i < s->footnotes->count; i++) {
    const Footnote *note = footnotes_at(s->footnotes, i);
    if (note->start < start(n) || note->start >= end(n)) continue;
    uint32_t at = leaf_byte(l, note->start, from, l->n);
    paragraph_part(s, l, from, at, first); footnote_definition(s, note, first);
    from = leaf_byte(l, note->consumed_end, at, l->n); s->skip_until = note->consumed_end;
  }
  paragraph_part(s, l, from, l->n, first);
}
static void plain_table(Semantic *s, TSNode n) {
  Document *d = s->d;
  leaf_single(d, start(n), end(n));
  begin(s, "paragraph", start(n), content_end(d, n));
  put(s, ",\"children\":["); parse_inlines(s, &d->leaf, 0); put(s, "]}");
}
static void heading(Semantic *s, TSNode n, bool setext) {
  uint32_t level = 2; TSNode content = n;
  if (setext) {
    content = find_child(s->d, n, s->d->ids.paragraph);
    if (!ts_node_is_null(find_child(s->d, n, s->d->ids.setext_h1))) level = 1;
  } else {
    TSNode marker = ts_node_named_child(n, 0);
    for (uint32_t i = 0; i < 6; i++) if (is(marker, s->d->ids.atx_markers[i])) level = i + 1;
  }
  begin(s, "heading", start(n), content_end(s->d, n)); put(s, ",\"depth\":"); number(s, level);
  leaf_build(s->d, content, setext ? SETEXT : ATX);
  put(s, ",\"children\":["); parse_inlines(s, &s->d->leaf, 0); put(s, "]}");
}
static void append_utf16(cmark_strbuf *out, Document *d, uint32_t a, uint32_t b) {
  for (; a < b; a++) {
    uint32_t c = d->text[a];
    if (c >= 0xd800 && c < 0xdc00 && a + 1 < b && d->text[a + 1] >= 0xdc00 && d->text[a + 1] < 0xe000)
      c = 0x10000 + ((c - 0xd800) << 10) + (d->text[++a] - 0xdc00);
    if (!c || (c >= 0xd800 && c < 0xe000)) c = 0xfffd;
    if (c == '\r') { if (a + 1 < b && d->text[a + 1] == '\n') a++; c = '\n'; }
    cmark_utf8proc_encode_char(c, out);
  }
}
static void continuations(Document *d, TSNode n, Words *ranges) {
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode c = ts_node_named_child(n, i);
    if (is(c, d->ids.block_continuation)) { word(ranges, start(c)); word(ranges, end(c)); continue; }
    continuations(d, c, ranges);
  }
}
static void source_value(Document *d, TSNode n, uint32_t a, uint32_t b, cmark_strbuf *out) {
  Words gaps = {0}; continuations(d, n, &gaps);
  for (uint32_t i = 0; i < gaps.n; i += 2) {
    if (gaps.v[i] < a || gaps.v[i] >= b) continue;
    append_utf16(out, d, a, gaps.v[i]); a = gaps.v[i + 1];
  }
  append_utf16(out, d, a, b); free(gaps.v);
}
static uint32_t column_at(Document *d, uint32_t a) {
  uint32_t line = a, column = 0;
  while (line && d->text[line - 1] != '\n' && d->text[line - 1] != '\r') line--;
  for (; line < a; line++) column += d->text[line] == '\t' ? 4 - column % 4 : 1;
  return column;
}
static uint32_t item_indent(Document *d, TSNode item) {
  TSNode marker = ts_node_named_child(item, 0); uint32_t a = start(marker), b = end(marker);
  uint32_t original = column_at(d, a), column = original;
  while (a < b && ws(d->text[a])) { column += d->text[a] == '\t' ? 4 - column % 4 : 1; a++; }
  while (a < b && !ws(d->text[a])) { column++; a++; }
  uint32_t padding = column;
  while (a < b && ws(d->text[a])) { column += d->text[a] == '\t' ? 4 - column % 4 : 1; a++; }
  uint32_t spaces = column - padding;
  return padding - original + (spaces == 0 || spaces > 4 ? 1 : spaces);
}
static uint32_t quote_indent(Document *d, TSNode quote) {
  TSNode marker = ts_node_named_child(quote, 0);
  uint32_t a = start(marker), b = end(marker), column = column_at(d, a), original = column;
  while (a < b && d->text[a] != '>') { column += d->text[a] == '\t' ? 4 - column % 4 : 1; a++; }
  if (a < b) { column++; a++; }
  if (a < b && (d->text[a] == ' ' || d->text[a] == '\t')) column++;
  return column - original;
}
static void append_line(cmark_strbuf *out, Document *d, uint32_t a, uint32_t b) {
  uint32_t column = column_at(d, a);
  while (a < b && (d->text[a] == ' ' || d->text[a] == '\t')) {
    uint32_t width = d->text[a++] == '\t' ? 4 - column % 4 : 1;
    column += width;
    for (uint32_t i = 0; i < width; i++) cmark_strbuf_putc(out, ' ');
  }
  append_utf16(out, d, a, b);
}
static uint32_t container_prefix(Document *d, TSNode parent, uint32_t a, uint32_t b, cmark_strbuf *out) {
  TSNode path[200]; uint32_t count = 0;
  for (; !ts_node_is_null(parent); parent = ts_node_parent(parent)) {
    if (count == 200) break;
    if (is(parent, d->ids.block_quote) || is(parent, d->ids.list_item)) path[count++] = parent;
  }
  uint32_t virtual_spaces = 0;
  while (count) {
    TSNode n = path[--count]; uint32_t column = column_at(d, a), width = 0;
    uint32_t required = is(n, d->ids.list_item) ? item_indent(d, n) : 3;
    while (a < b && width < required && (d->text[a] == ' ' || d->text[a] == '\t')) {
      uint32_t added = d->text[a] == '\t' ? 4 - column % 4 : 1;
      column += added; width += added; a++;
    }
    if (is(n, d->ids.list_item)) { virtual_spaces = width > required ? width - required : 0; continue; }
    if (a >= b || d->text[a] != '>') break;
    column++; a++;
    if (a < b && d->text[a] == ' ') a++;
    else if (a < b && d->text[a] == '\t') { virtual_spaces = 3 - column % 4; a++; }
  }
  while (virtual_spaces) { cmark_strbuf_putc(out, ' '); virtual_spaces--; }
  return a;
}
static void block_value(Document *d, TSNode n, uint32_t a, uint32_t b, cmark_strbuf *out,
                        bool preserve_whitespace) {
  bool first = true;
  while (a < b) {
    uint32_t stop = a;
    while (stop < b && d->text[stop] != '\r' && d->text[stop] != '\n') stop++;
    uint32_t from = first ? a : container_prefix(d, ts_node_parent(n), a, stop, out);
    if (preserve_whitespace) append_utf16(out, d, from, stop);
    else append_line(out, d, from, stop);
    first = false;
    if (stop < b) { cmark_strbuf_putc(out, '\n'); if (d->text[stop] == '\r' && stop + 1 < b && d->text[stop + 1] == '\n') stop++; stop++; }
    a = stop;
  }
}
static void normalize_indent(cmark_strbuf *source, uint32_t width, bool skip_first) {
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  bool line_start = true; uint32_t column = 0;
  for (uint32_t i = 0; i < (uint32_t)source->size; i++) {
    unsigned char c = source->ptr[i];
    if (line_start && !skip_first && column < width && (c == ' ' || c == '\t')) {
      column += c == '\t' ? 4 - column % 4 : 1;
      while (column > width) { cmark_strbuf_putc(&value, ' '); column--; }
      continue;
    }
    cmark_strbuf_putc(&value, c); line_start = c == '\n';
    if (line_start) { column = 0; skip_first = false; }
  }
  cmark_strbuf_free(source); *source = value;
}
static uint32_t line_end(Document *d, uint32_t at, uint32_t limit) {
  while (at < limit && d->text[at] != '\n' && d->text[at] != '\r') at++;
  return at;
}
static uint32_t next_line(Document *d, uint32_t at, uint32_t limit) {
  if (at < limit && d->text[at] == '\r') at++;
  if (at < limit && d->text[at] == '\n') at++;
  return at;
}
static bool math_closer(cmark_strbuf *line, uint32_t width) {
  uint32_t a = 0, count = 0;
  while (a < (uint32_t)line->size && a < 3 && line->ptr[a] == ' ') a++;
  while (a < (uint32_t)line->size && line->ptr[a] == '$') { count++; a++; }
  if (count < width) return false;
  while (a < (uint32_t)line->size && (line->ptr[a] == ' ' || line->ptr[a] == '\t')) a++;
  return a == (uint32_t)line->size;
}
static uint32_t math_limit(Document *d, TSNode n) {
  for (TSNode p = ts_node_parent(n); !ts_node_is_null(p); p = ts_node_parent(p))
    if (is(p, d->ids.list_item) || is(p, d->ids.block_quote)) return end(p);
  return d->len;
}
static bool math_block(Semantic *s, TSNode n, bool *first) {
  Document *d = s->d;
  if (!d->math) return false;
  uint32_t at = start(n), limit = math_limit(d, n), opening_end = line_end(d, at, limit), width = 0;
  while (at < opening_end && at - start(n) < 3 && d->text[at] == ' ') at++;
  uint32_t marker = at;
  while (at < opening_end && d->text[at] == '$') { at++; width++; }
  if (width < 2) return false;
  for (uint32_t i = at; i < opening_end; i++) if (d->text[i] == '$') return false;
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  uint32_t row = next_line(d, opening_end, limit), finish = opening_end, consumed = row;
  while (row < limit) {
    uint32_t stop = line_end(d, row, limit);
    cmark_strbuf line = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
    uint32_t from = container_prefix(d, ts_node_parent(n), row, stop, &line);
    append_utf16(&line, d, from, stop);
    consumed = next_line(d, stop, limit); finish = stop;
    if (math_closer(&line, width)) { cmark_strbuf_free(&line); break; }
    cmark_strbuf_put(&value, line.ptr, line.size); cmark_strbuf_free(&line);
    if (stop < limit) cmark_strbuf_putc(&value, '\n');
    row = consumed;
  }
  if (value.size && value.ptr[value.size - 1] == '\n') cmark_strbuf_truncate(&value, value.size - 1);
  separator(s, first); begin(s, "math", marker, finish); put(s, ",\"value\":"); string(s, value.ptr, value.size); put(s, "}");
  cmark_strbuf_free(&value); s->skip_until = consumed;
  if (consumed < end(n)) {
    leaf_build(d, n, PARAGRAPH); Leaf *l = &d->leaf;
    uint32_t body = leaf_byte(l, consumed, 0, l->n), b = l->n;
    while (body < b && ws(l->text[body])) body++;
    if (body < b) {
      separator(s, first); begin(s, "paragraph", mapped_start(l, body), mapped_end(l, b));
      put(s, ",\"children\":["); parse_inlines(s, l, body); put(s, "]}");
    }
  }
  return true;
}
static void code(Semantic *s, TSNode n, bool fenced) {
  Document *d = s->d; uint32_t a = start(n), b = end(n), width = 4;
  TSNode content = find_child(d, n, d->ids.code_fence_content), info = find_child(d, n, d->ids.info_string);
  TSNode opening = find_child(d, n, d->ids.fence_delimiter);
  const char *fence = "indented";
  if (fenced) {
    width = 0;
    uint32_t at = start(opening);
    while (at < end(opening) && (d->text[at] == ' ' || d->text[at] == '\t')) { width++; at++; }
    a = ts_node_is_null(content) ? b : start(content); b = ts_node_is_null(content) ? b : end(content);
    fence = "open";
    for (uint32_t i = 1; i < ts_node_named_child_count(n); i++)
      if (is(ts_node_named_child(n, i), d->ids.fence_delimiter)) fence = "closed";
  }
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  block_value(d, n, a, b, &value, fenced);
  uint32_t first_padding = 0;
  if (!fenced) {
    TSNode parent = ts_node_parent(n);
    if (!is(parent, d->ids.list_item) && !is(parent, d->ids.block_quote)) {
      uint32_t line = start(n);
      while (line && d->text[line - 1] != '\n' && d->text[line - 1] != '\r') line--;
      bool only_indent = true;
      for (uint32_t at = line; at < start(n); at++)
        if (d->text[at] != ' ' && d->text[at] != '\t') only_indent = false;
      uint32_t columns = column_at(d, start(n));
      if (only_indent && columns > 4) first_padding = columns - 4;
    }
    if (is(parent, d->ids.list_item)) {
      TSNode marker = ts_node_named_child(parent, 0);
      if (end(marker) == start(n)) {
        uint32_t marker_width = column_at(d, end(marker)) - column_at(d, start(marker));
        uint32_t required = item_indent(d, parent) + 4;
        if (marker_width > required) first_padding = marker_width - required;
      }
      for (uint32_t i = 0; i < ts_node_named_child_count(parent); i++) {
        TSNode child = ts_node_named_child(parent, i);
        if (start(child) == start(n) && end(child) == end(n) && ts_node_symbol(child) == ts_node_symbol(n)) break;
        if (!is(child, d->ids.block_continuation)) continue;
        uint32_t width = 0;
        for (uint32_t at = start(child); at < end(child); at++)
          width += d->text[at] == '\t' ? 4 - width % 4 : 1;
        if (width > item_indent(d, parent)) first_padding = width - item_indent(d, parent);
      }
    }
    if (is(parent, d->ids.block_quote)) {
      TSNode marker = find_child(d, parent, d->ids.block_quote_marker);
      for (uint32_t at = start(marker); at < end(marker); at++)
        if (d->text[at] == '\t') first_padding = 2;
    }
  }
  normalize_indent(&value, width, false);
  if (first_padding) {
    cmark_strbuf prefixed = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
    while (first_padding--) cmark_strbuf_putc(&prefixed, ' ');
    cmark_strbuf_put(&prefixed, value.ptr, value.size);
    cmark_strbuf_free(&value); value = prefixed;
  }
  if (!fenced) {
    while (value.size && value.ptr[value.size - 1] == '\n') cmark_strbuf_truncate(&value, value.size - 1);
    if (value.size) cmark_strbuf_putc(&value, '\n');
  }
  if (value.size && value.ptr[value.size - 1] != '\n') cmark_strbuf_putc(&value, '\n');
  begin(s, "code", start(n), content_end(d, n)); put(s, ",\"value\":");
  // Semantic code excludes the renderer's terminal newline, as mdast does.
  uint32_t value_len = value.size && value.ptr[value.size - 1] == '\n' ? value.size - 1 : value.size;
  string(s, value.ptr, value_len); put(s, ",\"language\":");
  cmark_strbuf metadata = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  if (!ts_node_is_null(info)) append_utf16(&metadata, d, start(info), end(info));
  cmark_chunk raw = {metadata.ptr, metadata.size}; unsigned char *clean = cmark_clean_url(cmark_get_default_mem_allocator(), &raw);
  uint32_t lang_end = 0; while (clean[lang_end] && !ws(clean[lang_end])) lang_end++;
  if (lang_end) string(s, clean, lang_end); else put(s, "null");
  uint32_t meta = lang_end; while (clean[meta] && ws(clean[meta])) meta++;
  put(s, ",\"meta\":"); nullable_string(s, clean + meta);
  put(s, ",\"fence\":\""); put(s, fence); put(s, "\"}");
  free(clean); cmark_strbuf_free(&metadata); cmark_strbuf_free(&value);
}
static bool blank_between(Document *d, uint32_t a, uint32_t b) {
  uint32_t lines = 0;
  for (; a < b; a++) {
    if (d->text[a] == '\r') { lines++; if (a + 1 < b && d->text[a + 1] == '\n') a++; }
    else if (d->text[a] == '\n') lines++;
  }
  return lines > 1;
}
static bool block_kind(Document *d, TSNode n) {
  uint16_t id = ts_node_symbol(n); Ids *i = &d->ids;
  return id == i->paragraph || id == i->reference_definition || id == i->atx_heading || id == i->setext_heading ||
    id == i->block_quote || id == i->list || id == i->thematic_break || id == i->fenced_code_block ||
    id == i->indented_code_block || id == i->html_block || id == i->pipe_table;
}
static bool item_spread(Document *d, TSNode item) {
  uint32_t previous = 0; bool found = false;
  for (uint32_t i = 0; i < ts_node_named_child_count(item); i++) {
    TSNode c = ts_node_named_child(item, i);
    if (!block_kind(d, c)) continue;
    if (found && blank_between(d, previous, start(c))) return true;
    previous = is(c, d->ids.block_quote) ? end(c) : content_end(d, c); found = true;
  }
  return false;
}
static bool list_spread(Document *d, TSNode list) {
  uint32_t previous = 0; bool found = false;
  for (uint32_t i = 0; i < ts_node_named_child_count(list); i++) {
    TSNode item = ts_node_named_child(list, i);
    if (!is(item, d->ids.list_item)) continue;
    if (item_spread(d, item) || (found && blank_between(d, previous, start(item)))) return true;
    previous = content_end(d, item);
    uint32_t count = ts_node_named_child_count(item);
    for (uint32_t j = count; j > 0; j--) {
      TSNode child = ts_node_named_child(item, j - 1);
      if (!block_kind(d, child)) continue;
      if (is(child, d->ids.block_quote)) previous = end(child);
      break;
    }
    found = true;
  }
  return false;
}
static void item(Semantic *s, TSNode n) {
  Document *d = s->d; begin(s, "listItem", start(n), content_end(d, n));
  put(s, item_spread(d, n) ? ",\"spread\":true" : ",\"spread\":false");
  put(s, ",\"checked\":");
  TSNode checked = find_child(d, n, d->ids.task_checked), unchecked = find_child(d, n, d->ids.task_unchecked);
  if (d->gfm && !ts_node_is_null(checked)) put(s, "true");
  else if (d->gfm && !ts_node_is_null(unchecked)) put(s, "false");
  else put(s, "null");
  put(s, ",\"children\":["); bool first = true; block_children(s, n, &first); put(s, "]}");
}
static void list(Semantic *s, TSNode n) {
  Document *d = s->d; TSNode marker = ts_node_named_child(ts_node_named_child(n, 0), 0);
  bool ordered = is(marker, d->ids.marker_dot) || is(marker, d->ids.marker_paren);
  begin(s, "list", start(n), content_end(d, n)); put(s, ordered ? ",\"ordered\":true,\"start\":" : ",\"ordered\":false,\"start\":");
  uint32_t value = 0, at = start(marker);
  while (at < end(marker) && ws(d->text[at])) at++;
  while (at < end(marker) && d->text[at] >= '0' && d->text[at] <= '9') value = value * 10 + d->text[at++] - '0';
  if (ordered) number(s, value); else put(s, "null");
  put(s, list_spread(d, n) ? ",\"spread\":true,\"items\":[" : ",\"spread\":false,\"items\":[");
  bool first = true;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode c = ts_node_named_child(n, i); if (!is(c, d->ids.list_item)) continue;
    separator(s, &first); item(s, c);
  }
  put(s, "]}");
}
static void cells(Document *d, TSNode row, Words *out) {
  uint32_t a = start(row), b = end(row);
  while (a < b && ws(d->text[a])) a++;
  while (b > a && ws(d->text[b - 1])) b--;
  if (a < b && d->text[a] == '|') a++;
  bool trailing = b > a && d->text[b - 1] == '|';
  if (trailing) {
    uint32_t escapes = 0, at = b - 1;
    while (at > a && d->text[--at] == '\\') escapes++;
    trailing = !(escapes % 2);
  }
  if (trailing) b--;
  uint32_t from = a;
  for (; a < b; a++) {
    if (d->text[a] == '\\' && a + 1 < b) { a++; continue; }
    if (d->text[a] != '|') continue;
    uint32_t x = from, y = a; while (x < y && ws(d->text[x])) x++; while (y > x && ws(d->text[y - 1])) y--;
    word(out, x); word(out, y); from = a + 1;
  }
  while (from < b && ws(d->text[from])) from++; while (b > from && ws(d->text[b - 1])) b--;
  word(out, from); word(out, b);
}
static void table_row(Semantic *s, TSNode row, uint32_t columns) {
  Words positions = {0}; cells(s->d, row, &positions);
  begin(s, "tableRow", start(row), content_end(s->d, row)); put(s, ",\"cells\":[");
  for (uint32_t i = 0; i < columns; i++) {
    if (i) put(s, ",");
    if (i * 2 >= positions.n) {
      put(s, "{\"type\":\"tableCell\",\"range\":null,\"children\":[]}"); continue;
    }
    uint32_t a = end(row), b = a;
    if (i * 2 < positions.n) { a = positions.v[i * 2]; b = positions.v[i * 2 + 1]; }
    begin(s, "tableCell", a, b); put(s, ",\"children\":[");
    leaf_single(s->d, a, b);
    Leaf *leaf = &s->d->leaf; uint32_t at = 0;
    for (uint32_t j = 0; j < leaf->n; j++) {
      uint32_t from = j;
      if (leaf->text[j] == '\\' && j + 1 < leaf->n && leaf->text[j + 1] == '|') j++;
      leaf->text[at] = leaf->text[j]; leaf->starts.v[at] = leaf->starts.v[from]; leaf->ends.v[at++] = leaf->ends.v[j];
    }
    leaf->n = at; leaf->text[at] = 0; leaf->starts.v[at] = b;
    parse_inlines(s, leaf, 0); put(s, "]}");
  }
  free(positions.v); put(s, "]}");
}
static void table(Semantic *s, TSNode n) {
  Document *d = s->d; TSNode delimiter = find_child(d, n, d->ids.pipe_table_delimiter_row);
  Words positions = {0}; cells(d, delimiter, &positions); uint32_t columns = positions.n / 2;
  begin(s, "table", start(n), content_end(d, n)); put(s, ",\"align\":[");
  for (uint32_t i = 0; i < columns; i++) {
    if (i) put(s, ",");
    uint32_t a = positions.v[i * 2], b = positions.v[i * 2 + 1];
    bool left = a < b && d->text[a] == ':', right = a < b && d->text[b - 1] == ':';
    if (left && right) put(s, "\"center\"");
    else if (left) put(s, "\"left\"");
    else if (right) put(s, "\"right\"");
    else put(s, "null");
  }
  free(positions.v); put(s, "],\"rows\":["); bool first = true;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode row = ts_node_named_child(n, i);
    if (is(row, d->ids.block_continuation) || is(row, d->ids.pipe_table_delimiter_row)) continue;
    separator(s, &first); table_row(s, row, columns);
  }
  put(s, "]}");
}
static bool contains_case(const unsigned char *text, uint32_t length, const char *part) {
  uint32_t size = strlen(part);
  for (uint32_t i = 0; i + size <= length; i++) if (!strncasecmp((char *)text + i, part, size)) return true;
  return false;
}
static const char *html_terminator(cmark_strbuf *value, uint32_t at) {
  if (contains_case(value->ptr + at, value->size - at, "<!--") && !memcmp(value->ptr + at, "<!--", 4)) return "-->";
  if (value->size > (int)at + 1 && value->ptr[at + 1] == '?') return "?>";
  if (value->size >= (int)at + 9 && !memcmp(value->ptr + at, "<![CDATA[", 9)) return "]]>";
  if (value->size > (int)at + 1 && value->ptr[at + 1] == '!') return ">";
  const char *tags[] = {"script", "pre", "style", "textarea"};
  const char *ends[] = {"</script>", "</pre>", "</style>", "</textarea>"};
  for (uint32_t i = 0; i < 4; i++) {
    uint32_t size = strlen(tags[i]);
    if ((uint32_t)value->size > at + 1 + size && !strncasecmp((char *)value->ptr + at + 1, tags[i], size) &&
        (ws(value->ptr[at + 1 + size]) || value->ptr[at + 1 + size] == '>')) return ends[i];
  }
  return NULL;
}
static void html(Semantic *s, TSNode n) {
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  block_value(s->d, n, start(n), end(n), &value, true);
  uint32_t at = 0;
  while (at < (uint32_t)value.size && value.ptr[at] == ' ') at++;
  const char *terminator = html_terminator(&value, at);
  bool closed = !terminator || contains_case(value.ptr, value.size, terminator);
  while (!terminator && value.size) {
    uint32_t b = value.size, a = b;
    if (a && value.ptr[a - 1] == '\n') a--;
    while (a && (value.ptr[a - 1] == ' ' || value.ptr[a - 1] == '\t')) a--;
    if (a && value.ptr[a - 1] != '\n') break;
    cmark_strbuf_truncate(&value, a);
  }
  if (closed && value.size && value.ptr[value.size - 1] == '\n') cmark_strbuf_truncate(&value, value.size - 1);
  uint32_t finish = end(n);
  if (closed) {
    while (finish > start(n) && (s->d->text[finish - 1] == '\r' || s->d->text[finish - 1] == '\n')) finish--;
    if (!terminator) finish = content_end(s->d, n);
  }
  begin(s, "html", start(n), finish); put(s, ",\"value\":");
  string(s, value.ptr, value.size); put(s, "}"); cmark_strbuf_free(&value);
}
static void block(Semantic *s, TSNode n, bool *first) {
  Document *d = s->d; uint16_t id = ts_node_symbol(n); Ids *i = &d->ids;
  if (end(n) <= s->skip_until) return;
  if (id == i->paragraph || id == i->reference_definition) {
    if (!math_block(s, n, first)) paragraph(s, n, first);
    return;
  }
  if (!block_kind(d, n)) { block_children(s, n, first); return; }
  separator(s, first);
  if (id == i->atx_heading || id == i->setext_heading) { heading(s, n, id == i->setext_heading); return; }
  if (id == i->list) { list(s, n); return; }
  if (id == i->fenced_code_block || id == i->indented_code_block) { code(s, n, id == i->fenced_code_block); return; }
  if (id == i->html_block) { html(s, n); return; }
  if (id == i->pipe_table) { if (d->gfm) table(s, n); else plain_table(s, n); return; }
  if (id == i->thematic_break) { begin(s, "thematicBreak", start(n), content_end(d, n)); put(s, "}"); return; }
  begin(s, "quote", start(n), content_end(d, n)); put(s, ",\"children\":[");
  bool child_first = true; block_children(s, n, &child_first); put(s, "]}");
}
static void block_children(Semantic *s, TSNode n, bool *first) {
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) block(s, ts_node_named_child(n, i), first);
}
uint32_t tsmd_semantics(Document *d) {
  free(d->semantic); d->semantic = NULL; d->semantic_len = 0;
  Semantic s = {.d = d, .json = CMARK_BUF_INIT(cmark_get_default_mem_allocator())};
  s.footnotes = footnotes_new(d); footnotes_scan(s.footnotes); s.root_footnotes = s.footnotes;
  s.defs = footnotes_definitions(s.footnotes);
  begin(&s, "root", 0, d->len); put(&s, ",\"children\":["); bool first = true;
  if (d->tree) block_children(&s, ts_tree_root_node(d->tree), &first);
  put(&s, "]}"); d->semantic_len = s.json.size; d->semantic = (char *)cmark_strbuf_detach(&s.json);
  footnotes_free(s.footnotes);
  cmark_reference_map_free(s.defs);
  return d->semantic_len;
}
char *tsmd_semantic_out(Document *d) { return d->semantic; }
void tsmd_semantic_release(Document *d) { free(d->semantic); d->semantic = NULL; d->semantic_len = 0; }
