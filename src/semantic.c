#include "resolver.h"
#include "autolink.h"
#include "houdini.h"
#include "utf8.h"
#include "footnote.h"
#include <strings.h>

typedef struct { const char *field; uint32_t index; } SemanticPath;
typedef struct {
  uint32_t start, end;
  unsigned char *identifier;
  bool footnote, resolved;
} SemanticReference;
typedef struct {
  Document *d;
  cmark_strbuf json;
  cmark_strbuf provisional, suppressed;
  SemanticPath *path;
  uint32_t path_count, path_cap, source_length;
  bool open, presentation;
  SemanticReference *references;
  uint32_t reference_count, reference_cap;
  uint32_t skip_until;
  Footnotes *footnotes;
  Footnotes *root_footnotes;
  cmark_reference_map *defs;
  bool lone_surrogates;
} Semantic;

static void put(Semantic *s, const char *text) { cmark_strbuf_puts(&s->json, text); }
static void number(Semantic *s, uint32_t n) {
  char digits[10]; uint32_t count = 0;
  do { digits[count++] = '0' + n % 10; n /= 10; } while (n);
  while (count) cmark_strbuf_putc(&s->json, digits[--count]);
}
static void mapped_string(Semantic *s, const unsigned char *text, uint32_t len,
                           const uint32_t *positions) {
  static const char hex[] = "0123456789abcdef";
  put(s, "\"");
  for (uint32_t i = 0; i < len; i++) {
    unsigned char c = text[i];
    if (positions && i + 2 < len && c == 0xef && text[i + 1] == 0xbf && text[i + 2] == 0xbd &&
        positions[i] != UINT32_MAX) {
      uint16_t unit = s->d->text[positions[i]];
      if (unit >= 0xd800 && unit < 0xe000) {
        char escape[] = {'\\', 'u', hex[unit >> 12], hex[(unit >> 8) & 15], hex[(unit >> 4) & 15], hex[unit & 15], 0};
        put(s, escape); i += 2; continue;
      }
    }
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
static void string(Semantic *s, const unsigned char *text, uint32_t len) {
  mapped_string(s, text, len, NULL);
}
static bool lone_surrogates(Document *d) {
  for (uint32_t i = 0; i < d->len; i++) {
    uint16_t c = d->text[i];
    if (c < 0xd800 || c >= 0xe000) continue;
    if (c < 0xdc00 && i + 1 < d->len && d->text[i + 1] >= 0xdc00 && d->text[i + 1] < 0xe000) { i++; continue; }
    return true;
  }
  return false;
}
static uint32_t literal_replacement(Document *d, uint32_t *from, uint32_t end) {
  while (*from < end) {
    uint32_t at = (*from)++; uint16_t c = d->text[at];
    if (c == 0xfffd) return at;
    if (c < 0xd800 || c >= 0xe000) continue;
    if (c < 0xdc00 && *from < end && d->text[*from] >= 0xdc00 && d->text[*from] < 0xe000) { (*from)++; continue; }
    return at;
  }
  return UINT32_MAX;
}
static Words literal_positions(Semantic *s, const unsigned char *text, uint32_t len,
                                uint32_t from, uint32_t end) {
  Words positions = {0};
  if (!s->lone_surrogates) return positions;
  for (uint32_t i = 0; i < len; i++) word(&positions, UINT32_MAX);
  for (uint32_t i = 0; i + 2 < len; i++) {
    if (text[i] != 0xef || text[i + 1] != 0xbf || text[i + 2] != 0xbd) continue;
    positions.v[i] = literal_replacement(s->d, &from, end); i += 2;
  }
  return positions;
}
static void literal_string(Semantic *s, const unsigned char *text, uint32_t len,
                            uint32_t from, uint32_t end) {
  Words positions = literal_positions(s, text, len, from, end);
  mapped_string(s, text, len, positions.v); free(positions.v);
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
  if (!*first) {
    put(s, ",");
    if (s->path_count) s->path[s->path_count - 1].index++;
  }
  *first = false;
}
static void child_array(Semantic *s, const char *field) {
  put(s, ",\""); put(s, field); put(s, "\":[");
  reserve((void **)&s->path, &s->path_cap, s->path_count + 1, sizeof(*s->path));
  s->path[s->path_count++] = (SemanticPath){field, 0};
}
static void child_array_end(Semantic *s) {
  put(s, "]}"); s->path_count--;
}
static void provisional(Semantic *s, const char *reason) {
  Semantic metadata = *s; metadata.json = s->provisional;
  if (metadata.json.size) put(&metadata, ",");
  put(&metadata, "{\"path\":[");
  for (uint32_t i = 0; i < s->path_count; i++) {
    if (i) put(&metadata, ",");
    put(&metadata, "\""); put(&metadata, s->path[i].field); put(&metadata, "\",");
    number(&metadata, s->path[i].index);
  }
  put(&metadata, "],\"reason\":\""); put(&metadata, reason); put(&metadata, "\"}");
  s->provisional = metadata.json;
}
static void suppressed(Semantic *s, uint32_t a, uint32_t b) {
  Semantic metadata = *s; metadata.json = s->suppressed;
  if (metadata.json.size) put(&metadata, ",");
  put(&metadata, "{"); range(&metadata, a, b);
  put(&metadata, ",\"reason\":\"empty-trailing-marker\"}");
  s->suppressed = metadata.json;
}
static bool open_source_end(Semantic *s, uint32_t end) {
  uint32_t mapped;
  return s->open && footnotes_map_source_end(s->footnotes, end, &mapped) && mapped == s->source_length;
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
static bool math_prefix(Document *, TSNode, uint32_t, uint32_t, uint32_t *, uint32_t *);
static TSNode math_trailing_prefix(Document *d, TSNode n) {
  uint32_t finish = end(n);
  while (ts_node_named_child_count(n)) {
    n = ts_node_named_child(n, ts_node_named_child_count(n) - 1);
    if (end(n) != finish) break;
    if (is(n, d->ids.block_continuation)) return n;
  }
  return (TSNode){0};
}
static bool math_eof_prefix(Document *d, TSNode n) {
  if (end(n) != d->len) return false;
  TSNode tail = math_trailing_prefix(d, n);
  if (ts_node_is_null(tail)) return false;
  uint32_t at, virtual;
  return math_prefix(d, n, start(tail), end(tail), &at, &virtual);
}
static uint32_t math_owned_end(Document *d, TSNode n) {
  uint32_t finish = end(n), delimiters = 0, closer = 0;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode c = ts_node_named_child(n, i);
    if (is(c, d->ids.math_delimiter)) { delimiters++; closer = end(c); }
  }
  if (delimiters > 1) {
    while (closer < finish && d->text[closer] != '\n' && d->text[closer] != '\r') closer++;
    return closer;
  }
  TSNode tail = math_trailing_prefix(d, n);
  if (!ts_node_is_null(tail)) {
    if (math_eof_prefix(d, n)) return start(tail);
    finish = start(tail);
  }
  if (finish == d->len) return finish;
  uint32_t row = finish, at, virtual;
  while (row > start(n) && d->text[row - 1] != '\n' && d->text[row - 1] != '\r') row--;
  if (row < finish && !math_prefix(d, n, row, finish, &at, &virtual)) finish = row;
  if (finish && d->text[finish - 1] == '\n') finish--;
  if (finish && d->text[finish - 1] == '\r') finish--;
  return finish;
}
static TSNode final_math(Document *d, TSNode n) {
  if (!d->math) return (TSNode){0};
  while (!ts_node_is_null(n)) {
    if (is(n, d->ids.math_flow)) return n;
    if (!is(n, d->ids.list) && !is(n, d->ids.list_item) && !is(n, d->ids.block_quote)) break;
    TSNode tail = (TSNode){0};
    for (uint32_t i = ts_node_named_child_count(n); i > 0; i--) {
      TSNode c = ts_node_named_child(n, i - 1);
      if (is(c, d->ids.block_continuation)) continue;
      tail = c; break;
    }
    n = tail;
  }
  return (TSNode){0};
}
static uint32_t math_container_end(Document *d, TSNode container, TSNode math) {
  return math_eof_prefix(d, math) ? end(container) : math_owned_end(d, math);
}
static uint32_t content_end(Document *d, TSNode n) {
  TSNode math = final_math(d, n);
  if (!ts_node_is_null(math)) return math_container_end(d, n, math);
  uint32_t b = end(n);
  while (b > start(n) && ws(d->text[b - 1])) b--;
  /* A trailing container marker is owned even when its final leaf ends earlier. */
  if (is(n, d->ids.block_quote) || is(n, d->ids.list)) return b;
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
static void code_source_value(Semantic *, cmark_node *, uint32_t, uint32_t);

static void inline_range(Leaf *l, cmark_node *n, uint32_t offset, uint32_t *a, uint32_t *b) {
  *a = mapped_start(l, offset + n->source_start);
  *b = mapped_end(l, offset + n->source_end);
  if (*b < *a) *b = *a;
}
static bool text_prefix(Leaf *l, cmark_node *n, uint32_t offset) {
  return n->len > 0 && n->len <= n->source_end - n->source_start &&
    !memcmp(n->data, l->text + offset + n->source_start, n->len);
}
static void text_value(Semantic *s, uint32_t a, uint32_t b, const unsigned char *data, uint32_t len,
                       const uint32_t *positions) {
  begin(s, "text", a, b); put(s, ",\"value\":"); mapped_string(s, data, len, positions); put(s, "}");
}
static void alt_payload(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset,
                         cmark_strbuf *out, Words *positions) {
  cmark_strbuf_put(out, n->data, n->len);
  if (!s->lone_surrogates) return;
  if (n->type == CMARK_NODE_TEXT) {
    bool prefix = text_prefix(l, n, offset);
    for (uint32_t i = 0; i < (uint32_t)n->len; i++)
      word(positions, prefix ? l->starts.v[offset + n->source_start + i] : UINT32_MAX);
    return;
  }
  uint32_t a, b; inline_range(l, n, offset, &a, &b);
  Words literal = literal_positions(s, n->data, n->len, a, b);
  for (uint32_t i = 0; i < literal.n; i++) word(positions, literal.v[i]);
  free(literal.v);
}
static void alt_text(Semantic *s, Leaf *l, cmark_strbuf *out, Words *positions,
                      cmark_node *n, uint32_t offset) {
  for (; n; n = n->next) {
    if (n->type == CMARK_NODE_TEXT || n->type == CMARK_NODE_CODE)
      alt_payload(s, l, n, offset, out, positions);
    if (n->type == CMARK_NODE_SOFTBREAK || n->type == CMARK_NODE_LINEBREAK) {
      cmark_strbuf_putc(out, '\n');
      if (s->lone_surrogates) word(positions, UINT32_MAX);
    }
    if (n->first_child) alt_text(s, l, out, positions, n->first_child, offset);
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
  const char *type = inline_type(n), *reason = NULL;
  switch (n->presentation) {
  case CMARK_PRESENTATION_EXACT: break;
  case CMARK_PRESENTATION_SUPPRESSED: abort();
  case CMARK_PRESENTATION_DELIMITER: reason = "unclosed-delimiter"; break;
  case CMARK_PRESENTATION_CODE: reason = "unclosed-code"; break;
  case CMARK_PRESENTATION_LINK: type = "pendingLink"; reason = "unclosed-link"; break;
  case CMARK_PRESENTATION_IMAGE: type = "pendingImage"; reason = "unclosed-image"; break;
  case CMARK_PRESENTATION_MATH: type = "pendingMath"; reason = "unclosed-math"; break;
  }
  begin(s, type, a, b);
  if (reason) provisional(s, reason);
  if (n->type == CMARK_NODE_FOOTNOTE_REFERENCE) {
    put(s, ",\"identifier\":"); string(s, n->data, n->len); put(s, "}"); return;
  }
  if (n->type == CMARK_NODE_SOFTBREAK || n->type == CMARK_NODE_LINEBREAK) {
    put(s, n->type == CMARK_NODE_LINEBREAK ? ",\"hard\":true}" : ",\"hard\":false}");
    return;
  }
  if (n->type == CMARK_NODE_TEXT || n->type == CMARK_NODE_CODE || n->type == CMARK_NODE_INLINE_MATH || n->type == CMARK_NODE_HTML_INLINE) {
    put(s, ",\"value\":");
    if (n->type != CMARK_NODE_TEXT) literal_string(s, n->data, n->len, a, b);
    else {
      const uint32_t *positions = s->lone_surrogates && text_prefix(l, n, offset) ?
        l->starts.v + offset + n->source_start : NULL;
      mapped_string(s, n->data, n->len, positions);
    }
    if (n->type == CMARK_NODE_CODE) code_source_value(s, n, a, b);
    put(s, "}");
    return;
  }
  if ((n->type == CMARK_NODE_LINK || n->type == CMARK_NODE_IMAGE) &&
      n->presentation != CMARK_PRESENTATION_LINK && n->presentation != CMARK_PRESENTATION_IMAGE) {
    put(s, ",\"url\":"); string(s, n->as.link.url, strlen((char *)n->as.link.url));
    put(s, ",\"title\":"); nullable_string(s, n->as.link.title);
    if (n->type == CMARK_NODE_LINK)
      put(s, l->text[offset + n->source_start] == '<' ? ",\"origin\":\"autolink\"" : ",\"origin\":\"markdown\"");
  }
  if (n->type == CMARK_NODE_IMAGE) {
    cmark_strbuf alt = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
    Words positions = {0}; alt_text(s, l, &alt, &positions, n->first_child, offset);
    put(s, ",\"alt\":"); mapped_string(s, alt.ptr, alt.size, positions.v);
    cmark_strbuf_free(&alt); free(positions.v); put(s, "}");
    return;
  }
  child_array(s, "children");
  inline_children(s, l, n->first_child, offset, in_link || n->type == CMARK_NODE_LINK);
  child_array_end(s);
}
static uint32_t leaf_byte(Leaf *l, uint32_t position, uint32_t from, uint32_t to) {
  while (from < to && l->starts.v[from] < position) from++;
  return from;
}
static void decoded_part(cmark_strbuf *out, Leaf *l, cmark_node *first, cmark_node *last,
                         uint32_t a, uint32_t b, Words *positions) {
  for (cmark_node *n = first; n; n = n->next) {
    uint32_t low = a > (uint32_t)n->source_start ? a : (uint32_t)n->source_start;
    uint32_t high = b < (uint32_t)n->source_end ? b : (uint32_t)n->source_end;
    bool prefix = text_prefix(l, n, 0);
    if (prefix && high > (uint32_t)(n->source_start + n->len)) high = n->source_start + n->len;
    uint32_t before = out->size;
    if (low < high && prefix)
      cmark_strbuf_put(out, n->data + low - n->source_start, high - low);
    else if (low < high && low == (uint32_t)n->source_start && high == (uint32_t)n->source_end)
      cmark_strbuf_put(out, n->data, n->len);
    else if (low < high) {
      cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
      houdini_unescape_html_f(&value, (unsigned char *)l->text + low, high - low);
      cmark_strbuf_unescape(&value);
      cmark_strbuf_put(out, value.ptr, value.size); cmark_strbuf_free(&value);
    }
    if (positions && low < high) {
      uint32_t length = out->size - before;
      for (uint32_t j = 0; j < length; j++) word(positions, length == high - low ? l->starts.v[low + j] : UINT32_MAX);
    }
    if (n == last) break;
  }
}
static void text_part(Semantic *s, Leaf *l, cmark_node *first, cmark_node *last,
                      uint32_t offset, uint32_t a, uint32_t b, bool link, bool *first_out) {
  if (a >= b) return;
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  // Nodes use body-relative bytes; leaf mappings include the stripped definitions.
  Leaf body = *l; body.text += offset; body.starts.v += offset; body.ends.v += offset;
  Words positions = {0};
  decoded_part(&value, &body, first, last, a, b, s->lone_surrogates ? &positions : NULL);
  separator(s, first_out);
  uint32_t start_pos = mapped_start(l, offset + a), end_pos = mapped_end(l, offset + b);
  if (!link) {
    text_value(s, start_pos, end_pos, value.ptr, value.size, positions.v);
    cmark_strbuf_free(&value); free(positions.v); return;
  }
  begin(s, "link", start_pos, end_pos); put(s, ",\"url\":");
  cmark_strbuf url = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  if (value.size >= 4 && !strncasecmp((char *)value.ptr, "www.", 4)) cmark_strbuf_puts(&url, "http://");
  if (memchr(value.ptr, '@', value.size) && !memchr(value.ptr, ':', value.size)) cmark_strbuf_puts(&url, "mailto:");
  cmark_strbuf_put(&url, value.ptr, value.size); string(s, url.ptr, url.size);
  put(s, ",\"origin\":\"gfm-autolink\",\"sourceValue\":");
  literal_string(s, (unsigned char *)l->text + offset + a, b - a, start_pos, end_pos);
  cmark_strbuf_clear(&url);
  const unsigned char *source = (unsigned char *)l->text + offset + a;
  if (b - a >= 4 && !strncasecmp((char *)source, "www.", 4)) cmark_strbuf_puts(&url, "http://");
  else if (memchr(source, '@', b - a) && !memchr(source, ':', b - a)) cmark_strbuf_puts(&url, "mailto:");
  cmark_strbuf_put(&url, source, b - a);
  put(s, ",\"sourceUrl\":"); literal_string(s, url.ptr, url.size, start_pos, end_pos);
  put(s, ",\"title\":null,\"children\":["); text_value(s, start_pos, end_pos, value.ptr, value.size, positions.v); put(s, "]}");
  cmark_strbuf_free(&url); cmark_strbuf_free(&value); free(positions.v);
}
static cmark_node *text_nodes(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset, bool *first) {
  cmark_node *last = n;
  while (last->next && last->next->type == CMARK_NODE_TEXT &&
         last->next->presentation != CMARK_PRESENTATION_SUPPRESSED && last->source_end == last->next->source_start)
    last = last->next;
  uint32_t a = n->source_start, b = last->source_end, at = a;
  Words links = {0}; autolinks(l, offset + a, offset + b, &links, s->d->cjk);
  for (uint32_t i = 0; i < links.n; i += 4) {
    uint32_t x = leaf_byte(l, links.v[i], offset + at, offset + b) - offset;
    uint32_t y = x;
    while (offset + y < l->n && l->ends.v[offset + y] <= links.v[i + 1]) y++;
    text_part(s, l, n, last, offset, at, x, false, first);
    text_part(s, l, n, last, offset, x, y, true, first); at = y;
  }
  text_part(s, l, n, last, offset, at, b, false, first);
  free(links.v); return last;
}
static void inline_children(Semantic *s, Leaf *l, cmark_node *n, uint32_t offset, bool in_link) {
  bool first = true;
  for (; n; n = n->next) {
    if (n->presentation == CMARK_PRESENTATION_SUPPRESSED) {
      uint32_t a, b; inline_range(l, n, offset, &a, &b); suppressed(s, a, b); continue;
    }
    if (n->type == CMARK_NODE_TEXT && !n->len) continue;
    if (n->flags & CMARK_NODE__GFM_AUTOLINK) {
      text_part(s, l, n->first_child, n->last_child, offset, n->source_start, n->source_end, true, &first);
      continue;
    }
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
static void collect_references(Semantic *s, Leaf *l, uint32_t body,
                                 cmark_reference_uses *uses) {
  for (size_t i = 0; i < uses->count; i++) {
    cmark_reference_use *use = &uses->items[i];
    uint32_t a = mapped_start(l, body + use->start), b = mapped_end(l, body + use->end);
    if (!footnotes_map_range(s->footnotes, a, b, &a, &b)) abort();
    reserve((void **)&s->references, &s->reference_cap, s->reference_count + 1, sizeof(*s->references));
    s->references[s->reference_count++] = (SemanticReference){a, b, use->identifier,
      use->form == CMARK_REFERENCE_FOOTNOTE, use->resolved};
    use->identifier = NULL;
  }
}
static cmark_node *inline_root(Semantic *s, Leaf *l, uint32_t body, bool observe) {
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)l->text + body; root->len = l->n - body;
  root->start_line = 1; root->start_column = 1;
  s->defs->lookup_footnote = lookup_footnote; s->defs->footnote_context = s->root_footnotes;
  s->defs->match_autolink = tsmd_gfm_autolink_match;
  cmark_reference_uses uses = {0};
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, s->defs,
                      (s->d->gfm ? CMARK_OPT_GFM : 0) | (s->d->cjk ? CMARK_OPT_CJK : 0) |
                        (s->d->math ? CMARK_OPT_MATH : 0) | (s->d->gfm ? CMARK_OPT_FOOTNOTES : 0) |
                        (open_source_end(s, l->source_end) ? CMARK_OPT_PRESENTATION : 0),
                      s->presentation && observe ? &uses : NULL);
  collect_references(s, l, body, &uses);
  cmark_reference_uses_free(cmark_get_default_mem_allocator(), &uses);
  s->defs->lookup_footnote = NULL; s->defs->footnote_context = NULL;
  root->data = NULL; root->len = 0;
  return root;
}
static void parse_inlines(Semantic *s, Leaf *l, uint32_t body) {
  cmark_node *root = inline_root(s, l, body, true);
  inline_children(s, l, root->first_child, body, false);
  cmark_node_free(root);
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
  child_array(s, "children");
  Document *document = s->d; Footnotes *notes = s->footnotes; uint32_t skip = s->skip_until;
  s->d = note->body; s->footnotes = note->nested; s->skip_until = 0;
  bool child_first = true; block_children(s, ts_tree_root_node(note->body->tree), &child_first);
  s->d = document; s->footnotes = notes; s->skip_until = skip;
  child_array_end(s);
}
static void paragraph_part(Semantic *s, Leaf *l, uint32_t a, uint32_t limit, bool *first) {
  Leaf part = *l; part.text += a; part.n = limit - a; part.starts.v += a; part.ends.v += a;
  if (limit != l->n) part.source_end = mapped_start(l, limit);
  l = &part;
  uint32_t body = definitions(s, l, first), b = l->n;
  while (b > body && ws(l->text[b - 1])) b--;
  if (body == b) return;
  cmark_node *root = inline_root(s, l, body, true);
  bool visible = false;
  for (cmark_node *n = root->first_child; n; n = n->next) {
    if (n->presentation == CMARK_PRESENTATION_SUPPRESSED) continue;
    if (n->type == CMARK_NODE_TEXT && !n->len) continue;
    visible = true;
    if (body + (uint32_t)n->source_end > b) b = body + n->source_end;
  }
  if (!visible) {
    inline_children(s, l, root->first_child, body, false);
    cmark_node_free(root); return;
  }
  separator(s, first); begin(s, "paragraph", mapped_start(l, body), mapped_end(l, b));
  child_array(s, "children"); inline_children(s, l, root->first_child, body, false); child_array_end(s);
  cmark_node_free(root);
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
  child_array(s, "children"); parse_inlines(s, &d->leaf, 0); child_array_end(s);
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
  child_array(s, "children"); parse_inlines(s, &s->d->leaf, 0); child_array_end(s);
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
static void append_line(cmark_strbuf *out, Document *d, uint32_t a, uint32_t b) {
  uint32_t column = source_column(d, a);
  while (a < b && (d->text[a] == ' ' || d->text[a] == '\t')) {
    uint32_t width = d->text[a++] == '\t' ? 4 - column % 4 : 1;
    column += width;
    for (uint32_t i = 0; i < width; i++) cmark_strbuf_putc(out, ' ');
  }
  append_utf16(out, d, a, b);
}
static uint32_t container_prefix(Document *d, Document *context, TSNode parent, uint32_t a, uint32_t b, cmark_strbuf *out, bool literal) {
  TSNode path[200]; uint32_t count = 0;
  for (; !ts_node_is_null(parent); parent = ts_node_parent(parent)) {
    if (count == 200) break;
    if (is(parent, context->ids.block_quote) || is(parent, context->ids.list_item)) path[count++] = parent;
  }
  uint32_t virtual_spaces = 0;
  while (count) {
    TSNode n = path[--count]; uint32_t column = source_column(d, a), width = 0;
    uint32_t saved = a, saved_virtual = virtual_spaces;
    bool list = is(n, context->ids.list_item);
    uint32_t required = list ? list_item_indent(context, n) : (literal ? UINT32_MAX : 3);
    if (literal) { width = virtual_spaces < required ? virtual_spaces : required; virtual_spaces -= width; }
    while (a < b && width < required && (d->text[a] == ' ' || d->text[a] == '\t')) {
      uint32_t added = d->text[a] == '\t' ? 4 - column % 4 : 1;
      column += added; width += added; a++;
    }
    bool matched = list ? width >= required : a < b && d->text[a] == '>';
    if (literal && !matched) { a = saved; virtual_spaces = saved_virtual; break; }
    if (list) { virtual_spaces = (literal ? virtual_spaces : 0) + (width > required ? width - required : 0); continue; }
    if (!matched) break;
    column++; a++;
    if (a < b && d->text[a] == ' ') a++;
    else if (a < b && d->text[a] == '\t') { virtual_spaces = 3 - column % 4; a++; }
  }
  while (virtual_spaces) { cmark_strbuf_putc(out, ' '); virtual_spaces--; }
  return a;
}
static bool source_padding(unsigned char c) { return c == ' ' || c == '\r' || c == '\n'; }
static void trim_source_padding(cmark_strbuf *value) {
  uint32_t a = 0, b = value->size;
  if (b < 2 || !source_padding(value->ptr[0]) || !source_padding(value->ptr[b - 1])) return;
  bool content = false;
  for (uint32_t i = 0; i < b; i++) if (!source_padding(value->ptr[i])) content = true;
  if (!content) return;
  a += value->ptr[0] == '\r' && value->ptr[1] == '\n' ? 2 : 1;
  b -= value->ptr[b - 1] == '\n' && value->ptr[b - 2] == '\r' ? 2 : 1;
  cmark_strbuf_drop(value, a); cmark_strbuf_truncate(value, b - a);
}
static void append_source(cmark_strbuf *out, Document *d, uint32_t a, uint32_t b) {
  for (; a < b; a++) {
    uint32_t c = d->text[a];
    if (c >= 0xd800 && c < 0xdc00 && a + 1 < b && d->text[a + 1] >= 0xdc00 && d->text[a + 1] < 0xe000)
      c = 0x10000 + ((c - 0xd800) << 10) + (d->text[++a] - 0xdc00);
    if (!c || (c >= 0xd800 && c < 0xe000)) c = 0xfffd;
    cmark_utf8proc_encode_char(c, out);
  }
}
static void code_source_value(Semantic *s, cmark_node *node, uint32_t a, uint32_t b) {
  Document *d = s->d;
  uint32_t line = a;
  while (line < b && d->text[line] != '\r' && d->text[line] != '\n') line++;
  if (line == b) {
    put(s, ",\"sourceValue\":"); literal_string(s, node->data, node->len, a, b); return;
  }
  TSNode context = ts_node_descendant_for_byte_range(ts_tree_root_node(d->tree), a * 2, a * 2);
  FootnoteSource source = {0};
  if (!footnotes_source_range(s->footnotes, a, b, &source)) abort();
  Document authored = {.text = source.text, .len = source.len};
  uint32_t source_a = a, source_b = b;
  d = &authored; a = 0; b = source.len;
  uint32_t ticks = 0;
  while (a + ticks < b && d->text[a + ticks] == '`') ticks++;
  a += ticks;
  if (node->presentation != CMARK_PRESENTATION_CODE) b -= ticks;
  uint32_t from = a;
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  while (from < b) {
    uint32_t stop = from;
    while (stop < b && d->text[stop] != '\r' && d->text[stop] != '\n') stop++;
    append_source(&value, d, from, stop);
    if (stop == b) break;
    uint32_t next = stop + 1;
    if (d->text[stop] == '\r' && next < b && d->text[next] == '\n') next++;
    append_source(&value, d, stop, next);
    from = container_prefix(d, s->d, context, next, b, &value, true);
  }
  trim_source_padding(&value);
  put(s, ",\"sourceValue\":"); literal_string(s, value.ptr, value.size, source_a, source_b);
  cmark_strbuf_free(&value); free(source.text);
}
static void block_value(Document *d, TSNode n, uint32_t a, uint32_t b, cmark_strbuf *out,
                        bool preserve_whitespace) {
  bool first = true;
  while (a < b) {
    uint32_t stop = a;
    while (stop < b && d->text[stop] != '\r' && d->text[stop] != '\n') stop++;
    uint32_t from = first ? a : container_prefix(d, d, ts_node_parent(n), a, stop, out, false);
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
static uint32_t math_spaces(Document *d, uint32_t stop, uint32_t *at, uint32_t *virtual, uint32_t limit) {
  uint32_t count = *virtual < limit ? *virtual : limit;
  *virtual -= count;
  while (*at < stop && count < limit && (d->text[*at] == ' ' || d->text[*at] == '\t')) {
    uint32_t width = d->text[*at] == '\t' ? 4 - source_column(d, *at) % 4 : 1;
    (*at)++;
    uint32_t used = width < limit - count ? width : limit - count;
    count += used; *virtual += width - used;
  }
  return count;
}
typedef struct { TSNode node; uint32_t indent; } MathContainer;
static bool math_prefix_item(Document *d, TSNode item, uint32_t required, uint32_t stop,
                             uint32_t *at, uint32_t *virtual) {
  TSNode marker = ts_node_named_child(item, 0);
  if (*at != start(marker)) return math_spaces(d, stop, at, virtual, required) == required;
  uint32_t before = source_column(d, *at);
  while (*at < end(marker) && ws(d->text[*at])) (*at)++;
  while (*at < stop && !ws(d->text[*at])) (*at)++;
  required -= source_column(d, *at) - before + *virtual;
  *virtual = 0;
  return math_spaces(d, stop, at, virtual, required) == required;
}
static bool math_prefix_container(Document *d, MathContainer container, uint32_t stop,
                                  uint32_t *at, uint32_t *virtual) {
  if (is(container.node, d->ids.list_item))
    return math_prefix_item(d, container.node, container.indent, stop, at, virtual);
  math_spaces(d, stop, at, virtual, 3);
  if (*virtual || *at == stop || d->text[*at] != '>') return false;
  (*at)++;
  math_spaces(d, stop, at, virtual, 1);
  return true;
}
static bool math_prefix_path(Document *d, MathContainer *path, uint32_t count, uint32_t row,
                             uint32_t stop, uint32_t *at, uint32_t *virtual) {
  *at = row; *virtual = 0;
  while (*at && d->text[*at - 1] != '\n' && d->text[*at - 1] != '\r') (*at)--;
  while (count) if (!math_prefix_container(d, path[--count], stop, at, virtual)) return false;
  return true;
}
static bool math_prefix(Document *d, TSNode n, uint32_t row, uint32_t stop, uint32_t *at, uint32_t *virtual) {
  MathContainer path[200]; uint32_t count = 0;
  for (TSNode p = ts_node_parent(n); !ts_node_is_null(p); p = ts_node_parent(p)) {
    if (count == 200) return false;
    if (is(p, d->ids.list_item) || is(p, d->ids.block_quote)) path[count++] = (MathContainer){p, 0};
  }
  for (uint32_t i = count; i > 0; i--) {
    TSNode item = path[i - 1].node;
    if (!is(item, d->ids.list_item)) continue;
    TSNode marker = ts_node_named_child(item, 0);
    uint32_t marker_at, marker_virtual;
    math_prefix_path(d, path + i, count - i, start(marker), start(marker), &marker_at, &marker_virtual);
    path[i - 1].indent = list_item_indent(d, item) + marker_virtual;
  }
  return math_prefix_path(d, path, count, row, stop, at, virtual);
}
typedef struct { uint32_t marker, suffix, opening_end, width, indent; } MathOpening;
static bool math_opening(Document *d, TSNode n, uint32_t row, MathOpening *opening) {
  uint32_t stop = line_end(d, row, end(n));
  uint32_t at, virtual;
  if (!math_prefix(d, n, row, stop, &at, &virtual)) return false;
  uint32_t indent = math_spaces(d, stop, &at, &virtual, 4);
  if (indent > 3) return false;
  uint32_t marker = at;
  while (at < stop && d->text[at] == '$') at++;
  if (at - marker < 2) return false;
  for (uint32_t i = at; i < stop; i++) if (d->text[i] == '$') return false;
  *opening = (MathOpening){marker, at, stop, at - marker, indent};
  return true;
}
static void math_body_line(Document *d, uint32_t from, uint32_t stop, uint32_t indent, cmark_strbuf *line) {
  uint32_t padding = line->size < indent ? line->size : indent;
  cmark_strbuf_truncate(line, line->size - padding);
  uint32_t virtual = 0;
  math_spaces(d, stop, &from, &virtual, indent - padding);
  while (virtual) { cmark_strbuf_putc(line, ' '); virtual--; }
  append_utf16(line, d, from, stop);
}
static void flow_math(Semantic *s, TSNode n, MathOpening opening, bool *first) {
  Document *d = s->d; uint32_t limit = math_owned_end(d, n);
  cmark_strbuf value = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  uint32_t row = next_line(d, opening.opening_end, limit), finish = opening.opening_end;
  uint32_t consumed = row, body_start = row;
  bool closed = false;
  while (row < limit) {
    uint32_t stop = line_end(d, row, limit);
    cmark_strbuf line = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
    uint32_t from, virtual;
    math_prefix(d, n, row, stop, &from, &virtual);
    while (virtual) { cmark_strbuf_putc(&line, ' '); virtual--; }
    uint32_t padding = line.size;
    append_line(&line, d, from, stop);
    consumed = next_line(d, stop, limit); finish = stop;
    if (math_closer(&line, opening.width)) { closed = true; cmark_strbuf_free(&line); break; }
    cmark_strbuf_truncate(&line, padding);
    math_body_line(d, from, stop, opening.indent, &line);
    cmark_strbuf_put(&value, line.ptr, line.size); cmark_strbuf_free(&line);
    if (stop < limit) cmark_strbuf_putc(&value, '\n');
    row = consumed;
  }
  if (value.size && value.ptr[value.size - 1] == '\n') cmark_strbuf_truncate(&value, value.size - 1);
  if (!closed) finish = limit;
  bool pending = !closed && (open_source_end(s, limit) ||
    (math_eof_prefix(d, n) && open_source_end(s, end(n))));
  separator(s, first); begin(s, pending ? "pendingMath" : "math", opening.marker, finish);
  if (pending) provisional(s, "unclosed-math");
  put(s, ",\"meta\":");
  uint32_t a = opening.suffix, b = opening.opening_end;
  while (a < b && (d->text[a] == ' ' || d->text[a] == '\t')) a++;
  cmark_strbuf meta = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  append_utf16(&meta, d, a, b);
  cmark_strbuf decoded = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  houdini_unescape_html_f(&decoded, meta.ptr, meta.size); cmark_strbuf_unescape(&decoded);
  if (decoded.size) literal_string(s, decoded.ptr, decoded.size, a, b); else put(s, "null");
  cmark_strbuf_free(&decoded);
  cmark_strbuf_free(&meta);
  put(s, ",\"value\":"); literal_string(s, value.ptr, value.size, body_start, finish); put(s, "}");
  cmark_strbuf_free(&value); s->skip_until = end(n);
}
static void math_block(Semantic *s, TSNode n, bool *first) {
  MathOpening opening;
  if (math_opening(s->d, n, start(n), &opening)) flow_math(s, n, opening, first);
}
static uint32_t fence_end(Document *d, TSNode n, bool closed) {
  uint32_t finish = end(n);
  for (TSNode tail = n; !closed && ts_node_named_child_count(tail);) {
    tail = ts_node_named_child(tail, ts_node_named_child_count(tail) - 1);
    if (end(tail) != finish) break;
    if (is(tail, d->ids.block_continuation) && start(tail) < finish) return start(tail);
  }
  bool quoted = false;
  for (TSNode parent = ts_node_parent(n); !ts_node_is_null(parent); parent = ts_node_parent(parent))
    if (is(parent, d->ids.block_quote)) quoted = true;
  if (!closed && !quoted) {
    for (TSNode parent = ts_node_parent(n); !ts_node_is_null(parent); parent = ts_node_parent(parent)) {
      if (!is(parent, d->ids.list_item)) continue;
      uint32_t owner = content_end(d, parent);
      if (owner < finish) finish = owner;
      break;
    }
    return finish;
  }
  if (finish > start(n) && d->text[finish - 1] == '\n') finish--;
  if (finish > start(n) && d->text[finish - 1] == '\r') finish--;
  return finish;
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
      uint32_t columns = source_column(d, start(n));
      if (only_indent && columns > 4) first_padding = columns - 4;
    }
    if (is(parent, d->ids.list_item)) {
      TSNode marker = ts_node_named_child(parent, 0);
      if (end(marker) == start(n)) {
        uint32_t marker_width = source_column(d, end(marker)) - source_column(d, start(marker));
        uint32_t required = list_item_indent(d, parent) + 4;
        if (marker_width > required) first_padding = marker_width - required;
      }
      for (uint32_t i = 0; i < ts_node_named_child_count(parent); i++) {
        TSNode child = ts_node_named_child(parent, i);
        if (start(child) == start(n) && end(child) == end(n) && ts_node_symbol(child) == ts_node_symbol(n)) break;
        if (!is(child, d->ids.block_continuation)) continue;
        uint32_t width = 0;
        for (uint32_t at = start(child); at < end(child); at++)
          width += d->text[at] == '\t' ? 4 - width % 4 : 1;
        if (width > list_item_indent(d, parent)) first_padding = width - list_item_indent(d, parent);
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
  uint32_t finish = content_end(d, n);
  if (!fenced) {
    uint32_t line = end(n);
    while (line > start(n) && d->text[line - 1] != '\n' && d->text[line - 1] != '\r') line--;
    uint32_t column = 0, at = line;
    while (at < end(n) && (d->text[at] == ' ' || d->text[at] == '\t')) {
      column += d->text[at] == '\t' ? 4 - column % 4 : 1; at++;
    }
    if (at == end(n) && column >= 4) finish = end(n);
  }
  if (fenced) finish = fence_end(d, n, !strcmp(fence, "closed"));
  begin(s, "code", start(n), finish); put(s, ",\"value\":");
  // Semantic code excludes the renderer's terminal newline, as mdast does.
  uint32_t value_len = value.size && value.ptr[value.size - 1] == '\n' ? value.size - 1 : value.size;
  literal_string(s, value.ptr, value_len, a, b); put(s, ",\"language\":");
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
    id == i->indented_code_block || id == i->html_block || id == i->pipe_table || (i->math_flow && id == i->math_flow);
}
static bool trailing_source_end(Semantic *s, uint32_t position) {
  while (position < s->d->len && ws(s->d->text[position])) position++;
  return open_source_end(s, position);
}
static bool visible_inline(cmark_node *root) {
  for (cmark_node *node = root->first_child; node; node = node->next) {
    if (node->presentation == CMARK_PRESENTATION_SUPPRESSED) continue;
    if (node->type == CMARK_NODE_TEXT && !node->len) continue;
    return true;
  }
  return false;
}
static bool leaf_definitions(Semantic *s, TSNode node, Leaf *leaf) {
  for (uint32_t i = 0; i < s->footnotes->count; i++) {
    const Footnote *note = footnotes_at(s->footnotes, i);
    if (note->start >= start(node) && note->start < end(node)) return true;
  }
  cmark_reference_map *map = cmark_reference_map_new(cmark_get_default_mem_allocator());
  bool definitions = strip_definitions(leaf, map, NULL) != 0;
  cmark_reference_map_free(map);
  return definitions;
}
static bool empty_inline_block(Semantic *s, TSNode node, int kind) {
  leaf_build(s->d, node, kind);
  Leaf *leaf = &s->d->leaf;
  if (kind == PARAGRAPH && leaf_definitions(s, node, leaf)) return false;
  uint32_t budget = s->defs->ref_size;
  cmark_node *root = inline_root(s, leaf, 0, false);
  bool empty = !visible_inline(root);
  cmark_node_free(root); s->defs->ref_size = budget;
  return empty;
}
static TSNode task_marker(Document *document, TSNode item) {
  TSNode checked = find_child(document, item, document->ids.task_checked);
  return ts_node_is_null(checked) ? find_child(document, item, document->ids.task_unchecked) : checked;
}
static bool empty_task(Semantic *s, TSNode node) {
  TSNode task = task_marker(s->d, node);
  if (ts_node_is_null(task)) return true;
  if (!s->d->gfm) return false;
  leaf_single(s->d, start(task), end(task));
  uint32_t budget = s->defs->ref_size;
  cmark_node *root = inline_root(s, &s->d->leaf, 0, false);
  bool empty = true;
  for (cmark_node *n = root->first_child; n; n = n->next)
    if (n->type != CMARK_NODE_TEXT) empty = false;
  cmark_node_free(root); s->defs->ref_size = budget;
  return empty;
}
static bool empty_trailing_block(Semantic *s, TSNode node) {
  Document *d = s->d; uint16_t id = ts_node_symbol(node); Ids *ids = &d->ids;
  if (!trailing_source_end(s, end(node))) return false;
  if (id == ids->atx_heading) return empty_inline_block(s, node, ATX);
  if (id == ids->paragraph) return empty_inline_block(s, node, PARAGRAPH);
  if (id != ids->block_quote && id != ids->list && id != ids->list_item) return false;
  if (id == ids->list_item && !empty_task(s, node)) return false;
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
    TSNode child = ts_node_named_child(node, i);
    if (!block_kind(d, child) && !is(child, ids->list_item)) continue;
    if (!empty_trailing_block(s, child)) return false;
  }
  return true;
}
static bool suppress_empty_block(Semantic *s, TSNode node) {
  if (!s->open || !empty_trailing_block(s, node)) return false;
  uint32_t finish = end(node);
  while (finish > start(node) && ws(s->d->text[finish - 1])) finish--;
  if (finish == start(node)) return false;
  suppressed(s, start(node), finish);
  return true;
}
static bool owned_quote_line(Document *d, uint32_t a, uint32_t b, uint32_t depth) {
  uint32_t quotes = 0;
  for (; a < b; a++) {
    if (d->text[a] == '>') { quotes++; continue; }
    if (d->text[a] != ' ' && d->text[a] != '\t') return true;
  }
  return quotes >= depth;
}
static uint32_t quote_spread_end(Document *d, TSNode quote) {
  uint32_t depth = 0;
  for (TSNode n = quote; !ts_node_is_null(n); n = ts_node_parent(n)) {
    if (is(n, d->ids.block_quote)) depth++;
  }
  uint32_t b = content_end(d, quote);
  while (b > start(quote)) {
    uint32_t line = b;
    while (line && d->text[line - 1] != '\n' && d->text[line - 1] != '\r') line--;
    if (owned_quote_line(d, line, b, depth)) return b;
    b = line;
    while (b > start(quote) && ws(d->text[b - 1])) b--;
  }
  return b;
}
static uint32_t spread_end(Document *d, TSNode node) {
  if (is(node, d->ids.block_quote)) return quote_spread_end(d, node);
  if (!is(node, d->ids.list) && !is(node, d->ids.list_item)) return content_end(d, node);
  for (uint32_t i = ts_node_named_child_count(node); i > 0; i--) {
    TSNode child = ts_node_named_child(node, i - 1);
    if (!block_kind(d, child) && !is(child, d->ids.list_item)) continue;
    return spread_end(d, child);
  }
  return content_end(d, node);
}
static bool item_spread(Document *d, TSNode item) {
  TSNode task = task_marker(d, item);
  uint32_t previous = ts_node_is_null(task) ? 0 : end(task);
  bool found = !ts_node_is_null(task);
  for (uint32_t i = 0; i < ts_node_named_child_count(item); i++) {
    TSNode c = ts_node_named_child(item, i);
    if (!block_kind(d, c)) continue;
    if (found && blank_between(d, previous, start(c))) return true;
    previous = spread_end(d, c); found = true;
  }
  return false;
}
static bool list_spread(Document *d, TSNode list) {
  uint32_t previous = 0; bool found = false;
  for (uint32_t i = 0; i < ts_node_named_child_count(list); i++) {
    TSNode item = ts_node_named_child(list, i);
    if (!is(item, d->ids.list_item)) continue;
    if (item_spread(d, item) || (found && blank_between(d, previous, start(item)))) return true;
    previous = spread_end(d, item);
    found = true;
  }
  return false;
}
static void item(Semantic *s, TSNode n) {
  Document *d = s->d; begin(s, "listItem", start(n), content_end(d, n));
  put(s, item_spread(d, n) ? ",\"spread\":true" : ",\"spread\":false");
  put(s, ",\"checked\":");
  TSNode task = task_marker(d, n);
  TSNode paragraph = find_child(d, n, d->ids.paragraph);
  bool has_content = !ts_node_is_null(paragraph) &&
    (ts_node_is_null(task) || !blank_between(d, end(task), start(paragraph)));
  if (d->gfm && has_content && is(task, d->ids.task_checked)) put(s, "true");
  else if (d->gfm && has_content && is(task, d->ids.task_unchecked)) put(s, "false");
  else put(s, "null");
  child_array(s, "children"); bool first = true;
  if (!has_content && !ts_node_is_null(task)) {
    leaf_single(d, start(task), end(task)); paragraph_part(s, &d->leaf, 0, d->leaf.n, &first);
  }
  block_children(s, n, &first); child_array_end(s);
}
static void list(Semantic *s, TSNode n) {
  Document *d = s->d; TSNode marker = ts_node_named_child(ts_node_named_child(n, 0), 0);
  bool ordered = is(marker, d->ids.marker_dot) || is(marker, d->ids.marker_paren);
  begin(s, "list", start(n), content_end(d, n)); put(s, ordered ? ",\"ordered\":true,\"start\":" : ",\"ordered\":false,\"start\":");
  uint32_t value = 0, at = start(marker);
  while (at < end(marker) && ws(d->text[at])) at++;
  while (at < end(marker) && d->text[at] >= '0' && d->text[at] <= '9') value = value * 10 + d->text[at++] - '0';
  if (ordered) number(s, value); else put(s, "null");
  put(s, list_spread(d, n) ? ",\"spread\":true" : ",\"spread\":false"); child_array(s, "items");
  bool first = true;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode c = ts_node_named_child(n, i); if (!is(c, d->ids.list_item)) continue;
    if (suppress_empty_block(s, c)) continue;
    separator(s, &first); item(s, c);
  }
  child_array_end(s);
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
  begin(s, "tableRow", start(row), content_end(s->d, row)); child_array(s, "cells");
  bool first = true;
  for (uint32_t i = 0; i < columns; i++) {
    separator(s, &first);
    if (i * 2 >= positions.n) {
      put(s, "{\"type\":\"tableCell\",\"range\":null,\"children\":[]}"); continue;
    }
    uint32_t a = end(row), b = a;
    if (i * 2 < positions.n) { a = positions.v[i * 2]; b = positions.v[i * 2 + 1]; }
    begin(s, "tableCell", a, b); child_array(s, "children");
    leaf_single(s->d, a, b);
    Leaf *leaf = &s->d->leaf; uint32_t at = 0;
    for (uint32_t j = 0; j < leaf->n; j++) {
      uint32_t from = j;
      if (leaf->text[j] == '\\' && j + 1 < leaf->n && leaf->text[j + 1] == '|') j++;
      leaf->text[at] = leaf->text[j]; leaf->starts.v[at] = leaf->starts.v[from]; leaf->ends.v[at++] = leaf->ends.v[j];
    }
    leaf->n = at; leaf->text[at] = 0; leaf->starts.v[at] = b;
    parse_inlines(s, leaf, 0); child_array_end(s);
  }
  free(positions.v); child_array_end(s);
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
  free(positions.v); put(s, "]"); child_array(s, "rows"); bool first = true;
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) {
    TSNode row = ts_node_named_child(n, i);
    if (is(row, d->ids.block_continuation) || is(row, d->ids.pipe_table_delimiter_row)) continue;
    separator(s, &first); table_row(s, row, columns);
  }
  child_array_end(s);
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
  literal_string(s, value.ptr, value.size, start(n), end(n)); put(s, "}"); cmark_strbuf_free(&value);
}
// Keep leaf-only temporaries off the recursive container traversal's Wasm stack.
static __attribute__((noinline)) void block_leaf(Semantic *s, TSNode n, bool *first) {
  Document *d = s->d; uint16_t id = ts_node_symbol(n); Ids *i = &d->ids;
  if (id == i->paragraph || id == i->reference_definition) {
    paragraph(s, n, first);
    return;
  }
  if (i->math_flow && id == i->math_flow) { math_block(s, n, first); return; }
  if (id == i->indented_code_block) {
    bool content = false;
    for (uint32_t at = start(n); at < end(n); at++) if (!ws(d->text[at])) content = true;
    if (!content) return;
  }
  separator(s, first);
  if (id == i->atx_heading || id == i->setext_heading) { heading(s, n, id == i->setext_heading); return; }
  if (id == i->fenced_code_block || id == i->indented_code_block) { code(s, n, id == i->fenced_code_block); return; }
  if (id == i->html_block) { html(s, n); return; }
  if (id == i->pipe_table) { if (d->gfm) table(s, n); else plain_table(s, n); return; }
  begin(s, "thematicBreak", start(n), content_end(d, n)); put(s, "}");
}
static void block(Semantic *s, TSNode n, bool *first) {
  Document *d = s->d; uint16_t id = ts_node_symbol(n); Ids *i = &d->ids;
  if (end(n) <= s->skip_until) return;
  if (suppress_empty_block(s, n)) return;
  if (!block_kind(d, n)) { block_children(s, n, first); return; }
  if (id != i->block_quote && id != i->list) { block_leaf(s, n, first); return; }
  separator(s, first);
  if (id == i->list) { list(s, n); return; }
  begin(s, "quote", start(n), content_end(d, n)); child_array(s, "children");
  bool child_first = true; block_children(s, n, &child_first); child_array_end(s);
}
static void block_children(Semantic *s, TSNode n, bool *first) {
  for (uint32_t i = 0; i < ts_node_named_child_count(n); i++) block(s, ts_node_named_child(n, i), first);
}
static int reference_order(const void *left, const void *right) {
  const SemanticReference *a = left, *b = right;
  if (a->start != b->start) return a->start < b->start ? -1 : 1;
  if (a->end != b->end) return a->end < b->end ? -1 : 1;
  return 0;
}
static void reference_metadata(Semantic *s) {
  if (s->reference_count) qsort(s->references, s->reference_count, sizeof(*s->references), reference_order);
  for (uint32_t i = 0; i < s->reference_count; i++) {
    const SemanticReference *use = &s->references[i];
    if (i) put(s, ",");
    put(s, use->footnote ? "{\"kind\":\"footnote\",\"identifier\":" : "{\"kind\":\"link\",\"identifier\":");
    string(s, use->identifier, strlen((char *)use->identifier)); put(s, ",");
    range(s, use->start, use->end);
    put(s, use->resolved ? ",\"resolution\":\"resolved\"}" : ",\"resolution\":\"unresolved\"}");
  }
}
static uint32_t semantic_result(Document *d, bool presentation, uint32_t ended) {
  free(d->semantic); d->semantic = NULL; d->semantic_len = 0;
  Semantic s = {.d = d, .json = CMARK_BUF_INIT(cmark_get_default_mem_allocator()),
    .provisional = CMARK_BUF_INIT(cmark_get_default_mem_allocator()),
    .suppressed = CMARK_BUF_INIT(cmark_get_default_mem_allocator()),
    .open = presentation && !ended, .presentation = presentation, .source_length = d->len};
  s.lone_surrogates = lone_surrogates(d);
  s.footnotes = footnotes_new(d); footnotes_scan(s.footnotes); s.root_footnotes = s.footnotes;
  s.defs = footnotes_definitions(s.footnotes);
  if (presentation) put(&s, ended ? "{\"input\":\"ended\",\"root\":" : "{\"input\":\"open\",\"root\":");
  begin(&s, "root", 0, d->len); child_array(&s, "children"); bool first = true;
  if (d->tree) block_children(&s, ts_tree_root_node(d->tree), &first);
  child_array_end(&s);
  if (presentation) {
    put(&s, ",\"provisional\":["); cmark_strbuf_put(&s.json, s.provisional.ptr, s.provisional.size);
    put(&s, "],\"suppressed\":["); cmark_strbuf_put(&s.json, s.suppressed.ptr, s.suppressed.size);
    put(&s, "],\"references\":["); reference_metadata(&s); put(&s, "]}");
  }
  d->semantic_len = s.json.size; d->semantic = (char *)cmark_strbuf_detach(&s.json);
  for (uint32_t i = 0; i < s.reference_count; i++) free(s.references[i].identifier);
  free(s.references);
  footnotes_free(s.footnotes);
  cmark_reference_map_free(s.defs);
  cmark_strbuf_free(&s.provisional); cmark_strbuf_free(&s.suppressed); free(s.path);
  return d->semantic_len;
}
uint32_t tsmd_semantics(Document *d) { return semantic_result(d, false, 0); }
uint32_t tsmd_presentation(Document *d, uint32_t ended) { return semantic_result(d, true, ended); }
char *tsmd_semantic_out(Document *d) { return d->semantic; }
void tsmd_semantic_release(Document *d) { free(d->semantic); d->semantic = NULL; d->semantic_len = 0; }
