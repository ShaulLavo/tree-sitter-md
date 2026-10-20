#ifndef CMARK_INLINES_H
#define CMARK_INLINES_H

#include "chunk.h"
#include "references.h"

#ifdef __cplusplus
extern "C" {
#endif

unsigned char *cmark_clean_url(cmark_mem *mem, cmark_chunk *url);
unsigned char *cmark_clean_title(cmark_mem *mem, cmark_chunk *title);

typedef enum {
  CMARK_REFERENCE_SHORTCUT,
  CMARK_REFERENCE_COLLAPSED,
  CMARK_REFERENCE_FULL,
  CMARK_REFERENCE_FOOTNOTE
} cmark_reference_form;

typedef struct {
  bufsize_t start, end, label_start, label_end;
  unsigned char *identifier;
  cmark_reference_form form;
  bool image, resolved;
} cmark_reference_use;

typedef struct {
  cmark_reference_use *items;
  size_t count, capacity;
} cmark_reference_uses;

typedef struct {
  const uint16_t *utf16;
  const uint32_t *starts;
} cmark_inline_source;

void cmark_reference_uses_free(cmark_mem *, cmark_reference_uses *);
void cmark_parse_inlines(cmark_mem *mem, cmark_node *parent,
                         cmark_reference_map *refmap, int options,
                         cmark_reference_uses *uses, const cmark_inline_source *source);

bufsize_t cmark_reference_definition_length(cmark_chunk *input, bufsize_t *title_start);

bufsize_t cmark_parse_reference_inline(cmark_mem *mem, cmark_chunk *input,
                                       cmark_reference_map *refmap);

#ifdef __cplusplus
}
#endif

#endif
