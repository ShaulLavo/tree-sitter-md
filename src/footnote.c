#include "footnote.h"

#include "utf8.h"

#include <ctype.h>

static void clear(Footnotes *footnotes) {
  for (uint32_t i = 0; i < footnotes->count; i++) free(footnotes->items[i].identifier);
  footnotes->count = 0;
}

static bool is_space(uint16_t value) {
  return value == ' ' || value == '\t' || value == '\r' || value == '\n';
}

static bool duplicate(const Footnotes *footnotes, const char *identifier, uint32_t length) {
  for (uint32_t i = 0; i < footnotes->count; i++) {
    const Footnote *item = &footnotes->items[i];
    if (item->identifier_len == length && !memcmp(item->identifier, identifier, length)) return true;
  }
  return false;
}

static char *normalize(const unsigned char *label, uint32_t length, uint32_t *normalized_length) {
  char *result = malloc(length + 1);
  if (!result) abort();
  uint32_t out = 0;
  bool pending_space = false;
  for (uint32_t i = 0; i < length; i++) {
    unsigned char value = label[i];
    if (value == ' ' || value == '\t' || value == '\r' || value == '\n') {
      pending_space = out > 0;
      continue;
    }
    if (pending_space) result[out++] = ' ', pending_space = false;
    result[out++] = (char)tolower(value);
  }
  while (out && result[out - 1] == ' ') out--;
  result[out] = 0;
  if (!out) {
    free(result);
    return NULL;
  }
  *normalized_length = out;
  return result;
}

static bool definition_header(Document *document, uint32_t start, uint32_t end, uint32_t *label_start,
                              uint32_t *label_end, uint32_t *body_start) {
  uint32_t at = start;
  while (at < end && is_space(document->text[at]) && document->text[at] != '\n') at++;
  if (at + 4 >= end || document->text[at++] != '[' || document->text[at++] != '^') return false;
  uint32_t label = at;
  while (at < end && document->text[at] != ']') {
    if (document->text[at] == '\n' || document->text[at] == '\r' || document->text[at] == '[')
      return false;
    at++;
  }
  if (at == label || at >= end || document->text[at++] != ']') return false;
  if (at >= end || document->text[at++] != ':') return false;
  *label_start = label;
  *label_end = at - 2;
  while (at < end && (document->text[at] == ' ' || document->text[at] == '\t')) at++;
  *body_start = at;
  return true;
}

/* A definition's continuation may be a lazy paragraph or an indented block.
 * Stop at the first blank line whose next line is a new, unindented block. */
static uint32_t extend_body_end(Document *document, uint32_t from) {
  uint32_t cursor = from;
  uint32_t last = from;
  while (cursor < document->len) {
    uint32_t line = cursor;
    while (cursor < document->len && document->text[cursor] != '\n') cursor++;
    uint32_t end = cursor;
    while (end > line && (document->text[end - 1] == '\r' || document->text[end - 1] == ' ' ||
                          document->text[end - 1] == '\t'))
      end--;
    bool blank = end == line;
    uint32_t next = cursor < document->len ? cursor + 1 : cursor;
    if (blank) {
      uint32_t probe = next;
      while (probe < document->len && (document->text[probe] == ' ' || document->text[probe] == '\t')) probe++;
      if (probe >= document->len || probe == next) break;
    }
    last = end;
    if (cursor == document->len) break;
    cursor = next;
  }
  return last;
}

static void add_definition(Footnotes *footnotes, TSNode node) {
  Document *document = footnotes->document;
  uint32_t from = ts_node_start_byte(node) / 2, to = ts_node_end_byte(node) / 2;
  uint32_t label_start, label_end, body_start;
  if (!definition_header(document, from, to, &label_start, &label_end, &body_start)) return;
  uint32_t label_length = 0;
  char *identifier = normalize((unsigned char *)(document->text + label_start), label_end - label_start,
                               &label_length);
  if (!identifier || duplicate(footnotes, identifier, label_length)) {
    free(identifier);
    return;
  }
  uint32_t body_end = extend_body_end(document, to);
  reserve((void **)&footnotes->items, &footnotes->capacity, footnotes->count + 1, sizeof(Footnote));
  footnotes->items[footnotes->count++] = (Footnote){
      .start = from,
      .end = to,
      .body_start = body_start,
      .body_end = body_end,
      .identifier = identifier,
      .identifier_len = label_length,
  };
}

static void walk(Footnotes *footnotes, TSNode node) {
  Document *document = footnotes->document;
  if (is(node, document->ids.reference_definition)) add_definition(footnotes, node);
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++)
    walk(footnotes, ts_node_named_child(node, i));
}

Footnotes *footnotes_new(Document *document) {
  Footnotes *footnotes = calloc(1, sizeof(*footnotes));
  if (!footnotes) abort();
  footnotes->document = document;
  return footnotes;
}

void footnotes_free(Footnotes *footnotes) {
  if (!footnotes) return;
  clear(footnotes);
  free(footnotes->items);
  free(footnotes);
}

void footnotes_scan(Footnotes *footnotes) {
  clear(footnotes);
  if (!footnotes->document->tree) return;
  walk(footnotes, ts_tree_root_node(footnotes->document->tree));
}

const Footnote *footnotes_at(const Footnotes *footnotes, uint32_t index) {
  return index < footnotes->count ? &footnotes->items[index] : NULL;
}

const Footnote *footnotes_lookup(const Footnotes *footnotes, const unsigned char *label, uint32_t length) {
  uint32_t normalized_length = 0;
  char *normalized = normalize(label, length, &normalized_length);
  if (!normalized) return NULL;
  const Footnote *result = NULL;
  for (uint32_t i = 0; i < footnotes->count; i++) {
    const Footnote *item = &footnotes->items[i];
    if (item->identifier_len == normalized_length && !memcmp(item->identifier, normalized, normalized_length)) {
      result = item;
      break;
    }
  }
  free(normalized);
  return result;
}

bool footnotes_contains(const Footnotes *footnotes, uint32_t start, uint32_t end) {
  for (uint32_t i = 0; i < footnotes->count; i++) {
    const Footnote *item = &footnotes->items[i];
    if (item->start <= start && item->end >= end) return true;
  }
  return false;
}
