#include "footnote.h"
#include "utf8.h"

Document *tsmd_new(uint32_t, const TSLanguage *);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);

typedef struct { uint32_t limit, count, steps[200]; } Container;

static bool horizontal(uint16_t c) { return c == ' ' || c == '\t'; }
static uint32_t line_end(Document *d, uint32_t at, uint32_t limit) {
  while (at < limit && d->text[at] != '\n') at++;
  return at;
}
static uint32_t line_start(Document *d, uint32_t at) {
  while (at && d->text[at - 1] != '\n') at--;
  return at;
}
static uint32_t trim_end(Document *d, uint32_t at, uint32_t from) {
  while (at > from && ws(d->text[at - 1])) at--;
  return at;
}
static void clear(Footnotes *notes) {
  for (uint32_t i = 0; i < notes->count; i++) {
    Footnote *note = &notes->items[i];
    free(note->identifier);
    free(note->starts.v); free(note->ends.v);
    footnotes_free(note->nested);
    tsmd_free(note->body);
  }
  notes->count = 0;
}
static char *normalize(const unsigned char *label, uint32_t length, uint32_t *size) {
  cmark_strbuf buffer = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  cmark_utf8proc_case_fold(&buffer, label, length);
  cmark_strbuf_trim(&buffer); cmark_strbuf_normalize_whitespace(&buffer);
  if (!buffer.size) { cmark_strbuf_free(&buffer); return NULL; }
  *size = buffer.size;
  return (char *)cmark_strbuf_detach(&buffer);
}
static char *identifier(Document *d, uint32_t a, uint32_t b, uint32_t *size) {
  cmark_strbuf utf8 = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  while (a < b) {
    uint32_t c = d->text[a++];
    if (c >= 0xd800 && c < 0xdc00 && a < b && d->text[a] >= 0xdc00 && d->text[a] < 0xe000)
      c = 0x10000 + ((c - 0xd800) << 10) + (d->text[a++] - 0xdc00);
    if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    cmark_utf8proc_encode_char(c ? c : 0xfffd, &utf8);
  }
  char *result = normalize(utf8.ptr, utf8.size, size);
  cmark_strbuf_free(&utf8); return result;
}
static bool header(Document *d, uint32_t a, uint32_t b, uint32_t *label_end, uint32_t *body) {
  if (a + 4 > b || d->text[a] != '[' || d->text[a + 1] != '^') return false;
  uint32_t at = a + 2;
  while (at < b && d->text[at] != ']') {
    if (ws(d->text[at]) || d->text[at] == '[') return false;
    if (d->text[at] == '\\' && at + 1 < b) at++;
    at++;
  }
  if (at == a + 2 || at + 1 >= b || d->text[at + 1] != ':') return false;
  *label_end = at; at += 2;
  while (at < b && horizontal(d->text[at])) at++;
  *body = at; return true;
}
static uint32_t indentation(Document *d, uint32_t *at, uint32_t b, uint32_t wanted) {
  uint32_t columns = 0;
  while (*at < b && horizontal(d->text[*at]) && columns < wanted)
    columns += d->text[(*at)++] == '\t' ? 4 - columns % 4 : 1;
  return columns;
}
static bool strip_container(Document *d, uint32_t *at, uint32_t b, Container container) {
  for (uint32_t i = 0; i < container.count; i++) {
    uint32_t indent = container.steps[i];
    if (indent) {
      if (indentation(d, at, b, indent) < indent) return false;
      continue;
    }
    indentation(d, at, b, 3);
    if (*at == b || d->text[*at] != '>') return false;
    (*at)++;
    if (*at < b && horizontal(d->text[*at])) (*at)++;
  }
  return true;
}
static bool final_paragraph(Document *d) {
  TSNode node = ts_tree_root_node(d->tree);
  while (ts_node_named_child_count(node))
    node = ts_node_named_child(node, ts_node_named_child_count(node) - 1);
  bool paragraph = false;
  while (!ts_node_is_null(node)) {
    if (is(node, d->ids.paragraph)) paragraph = true;
    if (is(node, d->ids.atx_heading) || is(node, d->ids.setext_heading) ||
        is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) ||
        is(node, d->ids.html_block)) return false;
    node = ts_node_parent(node);
  }
  return paragraph;
}
static bool paragraph_line(Document *d, uint32_t at) {
  TSNode node = ts_node_descendant_for_byte_range(ts_tree_root_node(d->tree), at * 2, at * 2);
  while (!ts_node_is_null(node)) {
    if (is(node, d->ids.paragraph)) return true;
    if (is(node, d->ids.atx_heading) || is(node, d->ids.setext_heading) ||
        is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) ||
        is(node, d->ids.reference_definition) || is(node, d->ids.list_item) ||
        is(node, d->ids.html_block) || is(node, d->ids.thematic_break)) return false;
    node = ts_node_parent(node);
  }
  return false;
}
static void append(Document *source, Footnote *note, uint32_t a, uint32_t b, uint32_t padding) {
  uint32_t count = b - a + padding;
  uint16_t *input = tsmd_input(note->body, count);
  for (uint32_t i = 0; i < padding; i++) {
    input[i] = ' '; word(&note->starts, a ? a - 1 : a); word(&note->ends, a);
  }
  for (uint32_t i = 0; i < b - a; i++) {
    input[padding + i] = source->text[a + i];
    word(&note->starts, a + i); word(&note->ends, a + i + 1);
  }
  tsmd_edit(note->body, note->body->len, note->body->len);
}
static void build_body(Document *d, Footnote *note, Container container) {
  note->body = tsmd_new(d->gfm ? 1 : 0, ts_parser_language(d->parser));
  note->body->cjk = d->cjk; note->body->math = d->math;
  tsmd_input(note->body, 0); tsmd_set_text(note->body);
  uint32_t stop = line_end(d, note->body_start, container.limit);
  uint32_t cursor = stop < container.limit ? stop + 1 : stop;
  append(d, note, note->body_start, cursor, 0);
  note->end = trim_end(d, stop, note->start);
  note->consumed_end = cursor;
  bool blank = stop == note->body_start;
  while (cursor < container.limit) {
    uint32_t a = cursor, b = line_end(d, cursor, container.limit);
    uint32_t next = b < container.limit ? b + 1 : b;
    if (!strip_container(d, &a, b, container)) break;
    uint32_t columns = indentation(d, &a, b, 4);
    bool empty = trim_end(d, b, a) == a;
    if (!empty && columns < 4 && (blank || !final_paragraph(note->body) || !paragraph_line(d, a))) break;
    append(d, note, a, next, columns > 4 ? columns - 4 : 0);
    if (!empty) note->end = trim_end(d, b, a);
    note->consumed_end = next; blank = empty; cursor = next;
  }
  note->body_end = note->end;
  word(&note->starts, note->end);
}
static bool contained(const Footnotes *notes, uint32_t at) {
  for (uint32_t i = 0; i < notes->count; i++) {
    const Footnote *note = &notes->items[i];
    if (at >= note->start && at < note->consumed_end) return true;
  }
  return false;
}
static void add(Footnotes *notes, uint32_t a, uint32_t origin, Container container) {
  Document *d = notes->document;
  if (contained(notes, a)) return;
  uint32_t label_end, content;
  if (!header(d, a, line_end(d, a, container.limit), &label_end, &content)) return;
  uint32_t logical = line_start(d, a);
  if (line_start(d, origin) == logical) logical = origin;
  else if (!strip_container(d, &logical, a, container)) return;
  if (indentation(d, &logical, a, 4) >= 4 || logical != a) return;
  Footnote note = {.start = a, .body_start = content};
  note.identifier = identifier(d, a + 2, label_end, &note.identifier_len);
  if (!note.identifier) return;
  build_body(d, &note, container);
  note.nested = footnotes_new(note.body);
  note.nested->depth = notes->depth + 1;
  note.nested->parent = notes;
  footnotes_scan(note.nested);
  reserve((void **)&notes->items, &notes->capacity, notes->count + 1, sizeof(Footnote));
  notes->items[notes->count] = note;
  notes->items[notes->count].nested->owner_index = notes->count;
  notes->count++;
}
static void scan_leaf(Footnotes *notes, TSNode node, Container container) {
  Document *d = notes->document;
  leaf_build(d, node, PARAGRAPH);
  Leaf *l = &d->leaf;
  bool beginning = true;
  for (uint32_t i = 0; i < l->n; i++) {
    if (beginning && l->text[i] == '[') add(notes, l->starts.v[i], start(node), container);
    beginning = l->text[i] == '\n';
  }
}
static void walk(Footnotes *notes, TSNode node, Container container) {
  Document *d = notes->document;
  if (is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) || is(node, d->ids.html_block)) return;
  if (is(node, d->ids.block_quote)) {
    if (container.count == 200) return;
    container.steps[container.count++] = 0; container.limit = end(node);
  }
  if (is(node, d->ids.list_item)) {
    TSNode marker = ts_node_named_child(node, 0);
    if (container.count == 200) return;
    container.steps[container.count++] = end(marker) - start(marker); container.limit = end(node);
  }
  if (is(node, d->ids.reference_definition) || is(node, d->ids.paragraph)) {
    scan_leaf(notes, node, container); return;
  }
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++)
    walk(notes, ts_node_named_child(node, i), container);
}
Footnotes *footnotes_new(Document *document) {
  Footnotes *notes = calloc(1, sizeof(*notes));
  if (!notes) abort();
  notes->document = document; return notes;
}
void footnotes_free(Footnotes *notes) {
  if (!notes) return;
  clear(notes); free(notes->items); free(notes);
}
void footnotes_scan(Footnotes *notes) {
  clear(notes);
  if (!notes->document->gfm || !notes->document->tree || notes->depth >= 200) return;
  walk(notes, ts_tree_root_node(notes->document->tree), (Container){.limit = notes->document->len});
}
const Footnote *footnotes_at(const Footnotes *notes, uint32_t index) {
  return index < notes->count ? &notes->items[index] : NULL;
}
const Footnote *footnotes_start(const Footnotes *notes, uint32_t position) {
  for (uint32_t i = 0; i < notes->count; i++) if (notes->items[i].start == position) return &notes->items[i];
  return NULL;
}
static const Footnote *find(const Footnotes *notes, const char *value, uint32_t size) {
  if (!notes) return NULL;
  for (uint32_t i = 0; i < notes->count; i++) {
    const Footnote *note = &notes->items[i];
    if (note->identifier_len == size && !memcmp(note->identifier, value, size)) return note;
    const Footnote *nested = find(note->nested, value, size);
    if (nested) return nested;
  }
  return NULL;
}
const Footnote *footnotes_lookup(const Footnotes *notes, const unsigned char *label, uint32_t length) {
  uint32_t size = 0;
  char *value = normalize(label, length, &size);
  if (!value) return NULL;
  const Footnote *result = find(notes, value, size);
  free(value); return result;
}
bool footnotes_contains(const Footnotes *notes, uint32_t a, uint32_t b) {
  for (uint32_t i = 0; i < notes->count; i++) {
    const Footnote *note = &notes->items[i];
    if (note->start <= a && note->consumed_end >= b) return true;
  }
  return false;
}

static bool footnote_label(const Footnotes *notes, const unsigned char *label) {
  uint32_t length = strlen((const char *)label);
  if (length && label[0] == '^') label++, length--;
  return footnotes_lookup(notes, label, length) != NULL;
}

cmark_reference_map *footnotes_definitions(const Footnotes *notes) {
  cmark_reference_map *result = cmark_reference_map_new(cmark_get_default_mem_allocator());
  if (!notes || !notes->document->defs) return result;
  uint32_t count = 0;
  for (cmark_reference *ref = notes->document->defs->refs; ref; ref = ref->next) count++;
  cmark_reference **refs = calloc(count ? count : 1, sizeof(*refs));
  uint32_t used = 0;
  for (cmark_reference *ref = notes->document->defs->refs; ref; ref = ref->next)
    if (!footnote_label(notes, ref->label)) refs[used++] = ref;
  for (uint32_t i = 1; i < used; i++) {
    cmark_reference *ref = refs[i]; uint32_t j = i;
    while (j && refs[j - 1]->age > ref->age) refs[j] = refs[j - 1], j--;
    refs[j] = ref;
  }
  for (uint32_t i = 0; i < used; i++) {
    cmark_reference *ref = refs[i];
    cmark_chunk label = {(unsigned char *)ref->label, strlen((char *)ref->label)};
    cmark_chunk url = {(unsigned char *)ref->url, ref->url ? strlen((char *)ref->url) : 0};
    cmark_chunk title = {(unsigned char *)ref->title, ref->title ? strlen((char *)ref->title) : 0};
    cmark_reference_create(result, &label, &url, &title);
  }
  free(refs);
  return result;
}

bool footnotes_map_range(const Footnotes *notes, uint32_t start, uint32_t end,
                         uint32_t *mapped_start, uint32_t *mapped_end) {
  if (!notes || !mapped_start || !mapped_end || start > end) return false;
  if (!notes->parent) {
    *mapped_start = start; *mapped_end = end; return true;
  }
  if (notes->owner_index >= notes->parent->count) return false;
  const Footnote *owner = &notes->parent->items[notes->owner_index];
  if (end > owner->body->len || start >= owner->starts.n) return false;
  uint32_t high = end ? end - 1 : start;
  if (high >= owner->ends.n) return false;
  uint32_t local_start = owner->starts.v[start];
  uint32_t local_end = owner->ends.v[high];
  return footnotes_map_range(notes->parent, local_start, local_end, mapped_start, mapped_end);
}
