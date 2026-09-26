#include <stdlib.h>
#include "cmark.h"
cmark_mem DEFAULT_MEM_ALLOCATOR = {calloc, realloc, free};
cmark_mem *cmark_get_default_mem_allocator(void) { return &DEFAULT_MEM_ALLOCATOR; }
