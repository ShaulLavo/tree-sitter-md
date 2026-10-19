#ifndef TSMD_TEST_NATIVE_LANGUAGE_H
#define TSMD_TEST_NATIVE_LANGUAGE_H
Document *tsmd_new(uint32_t, const TSLanguage *);
const TSLanguage *tree_sitter_markdown(void);
const TSLanguage *tree_sitter_markdown_chat(void);
static inline Document *test_document(uint32_t flags) {
  return tsmd_new(flags, flags & 8 ? tree_sitter_markdown_chat() : tree_sitter_markdown());
}
#endif
