#include "footnote.h"

#include <assert.h>

Document *tsmd_new(uint32_t, const TSLanguage *);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
const TSLanguage *tree_sitter_markdown(void);

static void set_text(Document *document, const char *source) {
  uint32_t length = strlen(source);
  uint16_t *input = tsmd_input(document, length);
  for (uint32_t i = 0; i < length; i++) input[i] = (unsigned char)source[i];
  tsmd_set_text(document);
}

int main(void) {
  Document *document = tsmd_new(1, tree_sitter_markdown());
  set_text(document, "[^A]: first\n\n[^b]: second\n[^a]: ignored\n");
  Footnotes *footnotes = footnotes_new(document);
  footnotes_scan(footnotes);
  assert(footnotes->count == 2);
  const Footnote *first = footnotes_lookup(footnotes, (const unsigned char *)"a", 1);
  assert(first && first->start == 0 && first->body_start > first->start);
  assert(footnotes_lookup(footnotes, (const unsigned char *)"A", 1) == first);
  assert(footnotes_lookup(footnotes, (const unsigned char *)"missing", 7) == NULL);
  assert(footnotes_contains(footnotes, first->start, first->end));
  set_text(document, "[^a]: first\nmore\n\nend\n");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  first = footnotes_at(footnotes, 0);
  assert(first && first->body_end > first->body_start + 5);
  footnotes_free(footnotes);
  tsmd_free(document);
  return 0;
}
