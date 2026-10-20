#ifndef TSMD_FOOTNOTE_H
#define TSMD_FOOTNOTE_H

#include "resolver.h"

typedef struct Footnotes Footnotes;

typedef struct {
  uint32_t start;
  uint32_t end;
  uint32_t body_start;
  uint32_t body_end;
  uint32_t consumed_end;
  char *identifier;
  uint32_t identifier_len;
  Document *body;
  Words starts, ends, containers;
  Footnotes *nested;
} Footnote;

struct Footnotes {
  Document *document;
  Footnote *items;
  uint32_t count;
  uint32_t capacity;
  uint32_t depth;
  Footnotes *parent;
  uint32_t owner_index;
};

typedef struct {
  uint32_t value_start, value_length, source_start, source_length;
  bool atom;
} FootnoteSourceRun;
typedef struct {
  uint16_t *text;
  uint32_t len, cap;
  FootnoteSourceRun *runs;
  uint32_t run_count, run_cap;
} FootnoteSource;

void footnotes_source_slice(FootnoteSource *out, const FootnoteSource *source,
                           uint32_t start, uint32_t end);
void footnotes_source_spaces(FootnoteSource *out, const FootnoteSource *source,
                            uint32_t at, uint32_t count);
void footnotes_source_free(FootnoteSource *source);

bool footnotes_source_range(const Footnotes *notes, uint32_t start, uint32_t end,
                            FootnoteSource *source);
Footnotes *footnotes_new(Document *document);
void footnotes_free(Footnotes *footnotes);
void footnotes_scan(Footnotes *footnotes);
const Footnote *footnotes_at(const Footnotes *footnotes, uint32_t index);
const Footnote *footnotes_start(const Footnotes *footnotes, uint32_t position);
const Footnote *footnotes_lookup(const Footnotes *footnotes, const unsigned char *label,
                                 uint32_t length);
bool footnotes_contains(const Footnotes *footnotes, uint32_t start, uint32_t end);
cmark_reference_map *footnotes_definitions(const Footnotes *footnotes);
bool footnotes_map_source_end(const Footnotes *notes, uint32_t end, uint32_t *mapped_end);
bool footnotes_map_range(const Footnotes *footnotes, uint32_t start, uint32_t end,
                         uint32_t *mapped_start, uint32_t *mapped_end);

#endif
