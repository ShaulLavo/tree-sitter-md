#include "resolver.h"
#include <assert.h>
#include <stdio.h>
Document *tsmd_new(uint32_t);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
uint32_t tsmd_decorations(Document *, uint32_t, uint32_t);
static void input(Document *d, const char *text) {
  size_t n = strlen(text); uint16_t *p = tsmd_input(d, n);
  for (size_t i = 0; i < n; i++) p[i] = (unsigned char)text[i];
}
int main(void) {
  Document *d = tsmd_new(1);
  const char *text = "counter 000000 [key]\n\n[key]: /one\n\n[KEY]: /two\n";
  input(d,text); tsmd_set_text(d);
  cmark_reference_map *map = d->defs;
  for (unsigned i=0;i<10000;i++) {
    char n[7]; snprintf(n,sizeof n,"%06u",i+100000);
    input(d,n); tsmd_edit(d,8,14);
    tsmd_decorations(d,0,d->len);
    assert(d->defs == map);
    assert(d->cache_count <= 8192);
  }
  // Eviction must still run even when reference definitions stay unchanged.
  assert(d->cache_count < 8192);
  size_t a = strstr(text,"[key]: /one")-text;
  input(d,""); tsmd_edit(d,a,a+strlen("[key]: /one\n\n"));
  cmark_chunk label = {(unsigned char *)"key",3};
  cmark_reference *r=cmark_reference_lookup(d->defs,&label);
  assert(r && !strcmp((char *)r->url,"/two"));
  input(d,"[key]\n\n"); tsmd_set_text(d);
  assert(d->defs->size==0);
  tsmd_free(d);
  puts("Reference-index identity: 10,000 ordinary edits; cache eviction and first-wins promotion passed");
}
