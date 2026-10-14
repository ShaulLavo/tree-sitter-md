#ifndef TSMD_FOOTNOTE_H
#define TSMD_FOOTNOTE_H

#include "resolver.h"

typedef struct {
  uint32_t start;
  uint32_t end;
  uint32_t body_start;
  uint32_t body_end;
  uint32_t consumed_end;
  char *identifier;
  uint32_t identifier_len;
  Document *body;
  Words starts, ends;
} Footnote;

typedef struct {
  Document *document;
  Footnote *items;
  uint32_t count;
  uint32_t capacity;
} Footnotes;

Footnotes *footnotes_new(Document *document);
void footnotes_free(Footnotes *footnotes);
void footnotes_scan(Footnotes *footnotes);
const Footnote *footnotes_at(const Footnotes *footnotes, uint32_t index);
const Footnote *footnotes_start(const Footnotes *footnotes, uint32_t position);
const Footnote *footnotes_lookup(const Footnotes *footnotes, const unsigned char *label,
                                 uint32_t length);
bool footnotes_contains(const Footnotes *footnotes, uint32_t start, uint32_t end);

#endif
