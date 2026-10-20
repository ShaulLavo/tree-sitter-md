#include "footnote.h"
#include "utf8.h"

Document *tsmd_new(uint32_t, const TSLanguage *);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);

typedef struct { uint32_t limit, count, steps[200]; } Container;
typedef struct { uint32_t width, from; } SourcePadding;

static bool horizontal(uint16_t c) { return c == ' ' || c == '\t'; }
static uint32_t line_end(Document *d, uint32_t at, uint32_t limit) {
  while (at < limit && d->text[at] != '\r' && d->text[at] != '\n') at++;
  return at;
}
static uint32_t line_start(Document *d, uint32_t at) {
  while (at && d->text[at - 1] != '\r' && d->text[at - 1] != '\n') at--;
  return at;
}
static uint32_t next_line(Document *d, uint32_t at, uint32_t limit) {
  if (at == limit) return at;
  if (d->text[at++] == '\r' && at < limit && d->text[at] == '\n') at++;
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
    free(note->starts.v); free(note->ends.v); free(note->containers.v);
    footnotes_free(note->nested);
    tsmd_free(note->body);
  }
  notes->count = 0;
}
static char *normalize(const unsigned char *label, uint32_t length, uint32_t *size) {
  cmark_chunk chunk = {(unsigned char *)label, length};
  char *result = (char *)cmark_normalize_reference(cmark_get_default_mem_allocator(), &chunk);
  if (result) *size = strlen(result);
  return result;
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
static uint32_t source_indentation(Document *d, uint32_t *at, uint32_t b,
                                    uint32_t wanted, SourcePadding *padding) {
  uint32_t column = 0, line = *at;
  while (line && d->text[line - 1] != '\r' && d->text[line - 1] != '\n') line--;
  for (; line < *at; line++) column += d->text[line] == '\t' ? 4 - column % 4 : 1;
  uint32_t width = padding->width < wanted ? padding->width : wanted;
  padding->width -= width;
  while (*at < b && horizontal(d->text[*at]) && width < wanted) {
    uint32_t added = d->text[(*at)++] == '\t' ? 4 - column % 4 : 1;
    column += added; width += added;
  }
  if (width > wanted) { padding->width += width - wanted; padding->from = *at - 1; }
  return width;
}
static bool strip_container(Document *d, uint32_t *at, uint32_t b, Container container,
                            SourcePadding *padding) {
  for (uint32_t i = 0; i < container.count; i++) {
    uint32_t indent = container.steps[i];
    if (indent &&
        (padding ? source_indentation(d, at, b, indent, padding) : indentation(d, at, b, indent)) < indent)
      return false;
    if (indent) continue;
    if (padding) source_indentation(d, at, b, 3, padding);
    else indentation(d, at, b, 3);
    if (*at == b || d->text[*at] != '>') return false;
    (*at)++;
    if (*at >= b || !horizontal(d->text[*at])) continue;
    if (padding) source_indentation(d, at, b, 1, padding);
    else (*at)++;
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
        (d->math && is(node, d->ids.math_flow)) || is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) ||
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
        (d->math && is(node, d->ids.math_flow)) || is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) ||
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
  note->body->footnote_parent = d;
  tsmd_input(note->body, 0); tsmd_set_text(note->body);
  uint32_t stop = line_end(d, note->body_start, container.limit);
  uint32_t cursor = next_line(d, stop, container.limit);
  append(d, note, note->body_start, cursor, 0);
  note->end = trim_end(d, stop, note->start);
  note->consumed_end = cursor;
  bool blank = stop == note->body_start;
  while (cursor < container.limit) {
    uint32_t a = cursor, b = line_end(d, cursor, container.limit);
    uint32_t next = next_line(d, b, container.limit);
    SourcePadding padding = {0};
    if (!strip_container(d, &a, b, container, &padding)) break;
    uint32_t content = a; SourcePadding saved_padding = padding;
    uint32_t columns = source_indentation(d, &a, b, 4, &padding);
    bool empty = trim_end(d, b, a) == a;
    if (!empty && columns < 4 && (blank || !final_paragraph(note->body) || !paragraph_line(d, a))) break;
    if (columns < 4) { a = content; padding = saved_padding; }
    append(d, note, a, next, padding.width);
    if (!empty) note->end = trim_end(d, b, a);
    note->consumed_end = next; blank = empty; cursor = next;
  }
  note->body_end = note->end;
  word(&note->starts, note->end);
  note->body->footnote_origins = note->starts.v;
  note->body->footnote_start = note->start;
}
bool footnote_lazy_continuation(Document *d, uint32_t at) {
  if (!d->footnote_parent || !d->footnote_origins || at >= d->len) return false;
  Document *parent = d->footnote_parent;
  uint32_t origin = d->footnote_origins[line_start(d, at)];
  uint32_t a = line_start(parent, origin), b = line_end(parent, origin, parent->len);
  TSNode path[200]; uint32_t count = 0;
  TSNode node = ts_node_descendant_for_byte_range(ts_tree_root_node(parent->tree),
    d->footnote_start * 2, d->footnote_start * 2);
  for (; !ts_node_is_null(node); node = ts_node_parent(node)) {
    if (!is(node, parent->ids.list_item) && !is(node, parent->ids.block_quote)) continue;
    if (count == 200) return false;
    path[count++] = node;
  }
  Container container = {0};
  while (count) {
    TSNode owner = path[--count];
    TSNode marker = ts_node_named_child(owner, 0);
    container.steps[container.count++] = is(owner, parent->ids.list_item) ? end(marker) - start(marker) : 0;
  }
  SourcePadding padding = {0};
  if (!strip_container(parent, &a, b, container, &padding)) return false;
  return source_indentation(parent, &a, b, 4, &padding) < 4;
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
  else if (!strip_container(d, &logical, a, container, NULL)) return;
  if (indentation(d, &logical, a, 4) >= 4 || logical != a) return;
  Footnote note = {.start = a, .body_start = content};
  for (uint32_t i = 0; i < container.count; i++) word(&note.containers, container.steps[i]);
  note.identifier = identifier(d, a + 2, label_end, &note.identifier_len);
  if (!note.identifier) { free(note.containers.v); return; }
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
typedef struct {
  TSNode node;
  Container container;
  uint32_t next_child;
  bool entered;
} WalkEntry;

static bool enter(Footnotes *notes, WalkEntry *entry) {
  Document *d = notes->document;
  TSNode node = entry->node;
  entry->entered = true;
  if ((d->math && is(node, d->ids.math_flow)) || is(node, d->ids.fenced_code_block) || is(node, d->ids.indented_code_block) || is(node, d->ids.html_block)) return false;
  if (is(node, d->ids.block_quote) || is(node, d->ids.list_item)) {
    if (entry->container.count == 200) return false;
    TSNode marker = ts_node_named_child(node, 0);
    uint32_t width = is(node, d->ids.list_item) ? end(marker) - start(marker) : 0;
    entry->container.steps[entry->container.count++] = width;
    entry->container.limit = end(node);
  }
  if (!is(node, d->ids.reference_definition) && !is(node, d->ids.paragraph)) return true;
  scan_leaf(notes, node, entry->container);
  return false;
}

static void walk(Footnotes *notes, TSNode root, Container initial) {
  WalkEntry *stack = NULL;
  uint32_t count = 0, capacity = 0;
  reserve((void **)&stack, &capacity, 1, sizeof(*stack));
  stack[count++] = (WalkEntry){root, initial, 0, false};
  while (count) {
    WalkEntry *entry = &stack[count - 1];
    if (!entry->entered && !enter(notes, entry)) {
      count--;
      continue;
    }
    uint32_t children = ts_node_named_child_count(entry->node);
    if (entry->next_child == children) {
      count--;
      continue;
    }
    TSNode child = ts_node_named_child(entry->node, entry->next_child++);
    Container container = entry->container;
    reserve((void **)&stack, &capacity, count + 1, sizeof(*stack));
    stack[count++] = (WalkEntry){child, container, 0, false};
  }
  free(stack);
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
  if (!length || label[0] != '^') return false;
  label++; length--;
  return footnotes_lookup(notes, label, length) != NULL;
}

typedef struct { cmark_reference *ref; uint32_t position, age; } ReferenceEntry;
typedef struct { ReferenceEntry *items; uint32_t count, capacity; } ReferenceEntries;

static void source_definitions(const Footnotes *root, const Footnotes *notes,
                               const DefSource *source, ReferenceEntries *entries) {
  if (contained(notes, source->start)) return;
  uint32_t position, ignored;
  if (!footnotes_map_range(notes, source->start, source->start, &position, &ignored)) abort();
  for (cmark_reference *ref = source->map->refs; ref; ref = ref->next) {
    if (footnote_label(root, ref->label)) continue;
    reserve((void **)&entries->items, &entries->capacity, entries->count + 1, sizeof(ReferenceEntry));
    entries->items[entries->count++] = (ReferenceEntry){ref, position, ref->age};
  }
}

static void collect_definitions(const Footnotes *root, const Footnotes *notes, ReferenceEntries *entries) {
  if (!notes) return;
  Document *d = notes->document;
  for (uint32_t i = 0; i < d->source_count; i++) source_definitions(root, notes, &d->sources[i], entries);
  for (uint32_t i = 0; i < notes->count; i++) collect_definitions(root, notes->items[i].nested, entries);
}

static int compare_definitions(const void *first, const void *second) {
  const ReferenceEntry *a = first, *b = second;
  if (a->position != b->position) return a->position < b->position ? -1 : 1;
  if (a->age != b->age) return a->age < b->age ? -1 : 1;
  return 0;
}

static unsigned char *copy_string(const unsigned char *value) {
  if (!value) return NULL;
  unsigned char *result = (unsigned char *)strdup((const char *)value);
  if (!result) abort();
  return result;
}

static void clone_definition(cmark_reference_map *map, const cmark_reference *ref, uint32_t age) {
  cmark_reference *copy = map->mem->calloc(1, sizeof(*copy));
  if (!copy) abort();
  copy->label = copy_string(ref->label);
  copy->url = copy_string(ref->url);
  copy->title = copy_string(ref->title);
  copy->size = ref->size; copy->age = age;
  copy->next = map->refs; map->refs = copy; map->size++;
}

cmark_reference_map *footnotes_definitions(const Footnotes *notes) {
  cmark_reference_map *result = cmark_reference_map_new(cmark_get_default_mem_allocator());
  ReferenceEntries entries = {0};
  collect_definitions(notes, notes, &entries);
  if (entries.count) qsort(entries.items, entries.count, sizeof(ReferenceEntry), compare_definitions);
  for (uint32_t i = 0; i < entries.count; i++) clone_definition(result, entries.items[i].ref, i);
  free(entries.items); return result;
}

bool footnotes_map_source_end(const Footnotes *notes, uint32_t end, uint32_t *mapped_end) {
  if (!notes || end > notes->document->len) return false;
  if (!notes->parent) { *mapped_end = end; return true; }
  if (notes->owner_index >= notes->parent->count) return false;
  const Footnote *owner = &notes->parent->items[notes->owner_index];
  if (end >= owner->starts.n) return false;
  uint32_t parent_end = end == owner->body->len ? owner->consumed_end : owner->starts.v[end];
  return footnotes_map_source_end(notes->parent, parent_end, mapped_end);
}

bool footnotes_map_range(const Footnotes *notes, uint32_t start, uint32_t end,
                         uint32_t *mapped_start, uint32_t *mapped_end) {
  if (!notes || !mapped_start || !mapped_end || start > end) return false;
  if (!notes->parent) {
    *mapped_start = start; *mapped_end = end; return true;
  }
  if (notes->owner_index >= notes->parent->count) return false;
  const Footnote *owner = &notes->parent->items[notes->owner_index];
  if (!owner->starts.n || end > owner->body->len || start > owner->starts.n - 1) return false;
  if (start == end) {
    *mapped_start = owner->starts.v[start]; *mapped_end = *mapped_start;
    return footnotes_map_range(notes->parent, *mapped_start, *mapped_end, mapped_start, mapped_end);
  }
  uint32_t high = end ? end - 1 : start;
  if (high >= owner->ends.n) return false;
  uint32_t local_start = owner->starts.v[start];
  uint32_t local_end = owner->ends.v[high];
  return footnotes_map_range(notes->parent, local_start, local_end, mapped_start, mapped_end);
}

static void source_run(FootnoteSource *out, uint32_t count, uint32_t start,
                       uint32_t length, bool atom) {
  if (!count) return;
  FootnoteSourceRun *last = out->run_count ? &out->runs[out->run_count - 1] : NULL;
  bool adjacent = last && last->source_start + last->source_length == start;
  bool same_atom = last && last->atom && atom && last->source_start == start && last->source_length == length;
  if (same_atom || (last && !last->atom && !atom && adjacent)) {
    last->value_length += count;
    if (!atom) last->source_length += length;
    return;
  }
  reserve((void **)&out->runs, &out->run_cap, out->run_count + 1, sizeof(*out->runs));
  out->runs[out->run_count++] = (FootnoteSourceRun){out->len, count, start, length, atom};
}
static void source_append(FootnoteSource *out, const uint16_t *text, uint32_t count) {
  reserve((void **)&out->text, &out->cap, out->len + count, sizeof(uint16_t));
  if (count) memcpy(out->text + out->len, text, count * sizeof(uint16_t));
  out->len += count;
}
void footnotes_source_slice(FootnoteSource *out, const FootnoteSource *source,
                           uint32_t start, uint32_t end) {
  if (start > end || end > source->len) abort();
  for (uint32_t i = 0; i < source->run_count; i++) {
    FootnoteSourceRun run = source->runs[i];
    uint32_t from = start > run.value_start ? start : run.value_start;
    uint32_t stop = end < run.value_start + run.value_length ? end : run.value_start + run.value_length;
    if (from >= stop) continue;
    uint32_t at = run.source_start + (run.atom ? 0 : from - run.value_start);
    source_run(out, stop - from, at, run.atom ? run.source_length : stop - from, run.atom);
    source_append(out, source->text + from, stop - from);
  }
}
void footnotes_source_spaces(FootnoteSource *out, const FootnoteSource *source,
                            uint32_t at, uint32_t count) {
  if (!count) return;
  for (uint32_t i = 0; i < source->run_count; i++) {
    FootnoteSourceRun run = source->runs[i];
    if (at < run.value_start || at >= run.value_start + run.value_length) continue;
    uint32_t start = run.source_start + (run.atom ? 0 : at - run.value_start);
    source_run(out, count, start, run.atom ? run.source_length : 1, true);
    reserve((void **)&out->text, &out->cap, out->len + count, sizeof(uint16_t));
    while (count--) out->text[out->len++] = ' ';
    return;
  }
  abort();
}
void footnotes_source_free(FootnoteSource *source) {
  free(source->text); free(source->runs); *source = (FootnoteSource){0};
}
static uint32_t source_line_prefix(Document *d, uint32_t a, uint32_t b,
                                   Container container, SourcePadding *padding) {
  uint32_t at = a;
  if (!strip_container(d, &at, b, container, padding)) { *padding = (SourcePadding){0}; return a; }
  uint32_t saved = at; SourcePadding saved_padding = *padding;
  if (source_indentation(d, &at, b, 4, padding) < 4) {
    *padding = saved_padding; return saved;
  }
  return at;
}
static void source_body(FootnoteSource *out, FootnoteSource *parent, const Footnote *note) {
  Document view = {.text = parent->text, .len = parent->len};
  Container container = {.count = note->containers.n};
  if (container.count) memcpy(container.steps, note->containers.v, container.count * sizeof(uint32_t));
  uint32_t at = 0;
  bool first = true;
  while (at < view.len) {
    uint32_t stop = at; SourcePadding padding = {0};
    while (stop < view.len && view.text[stop] != '\r' && view.text[stop] != '\n') stop++;
    uint32_t from = first ? at : source_line_prefix(&view, at, stop, container, &padding);
    footnotes_source_spaces(out, parent, padding.from, padding.width);
    uint32_t next = stop;
    if (next < view.len && view.text[next] == '\r') next++;
    if (next < view.len && view.text[next] == '\n') next++;
    footnotes_source_slice(out, parent, from, next);
    first = false; at = next;
  }
}
bool footnotes_source_range(const Footnotes *notes, uint32_t start, uint32_t end,
                            FootnoteSource *source) {
  if (!notes || start > end || end > notes->document->len) return false;
  if (!notes->parent) {
    source_run(source, end - start, start, end - start, false);
    source_append(source, notes->document->text + start, end - start); return true;
  }
  if (notes->owner_index >= notes->parent->count) return false;
  const Footnote *owner = &notes->parent->items[notes->owner_index];
  if (start == end) return true;
  if (end > owner->ends.n || start >= owner->starts.n) return false;
  FootnoteSource parent = {0};
  if (!footnotes_source_range(notes->parent, owner->starts.v[start], owner->ends.v[end - 1], &parent)) {
    footnotes_source_free(&parent); return false;
  }
  source_body(source, &parent, owner);
  footnotes_source_free(&parent); return true;
}
