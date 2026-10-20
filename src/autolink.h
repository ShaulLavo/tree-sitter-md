#ifndef TSMD_AUTOLINK_H
#define TSMD_AUTOLINK_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool tsmd_gfm_autolink_match(const uint8_t *data, size_t size, size_t at,
                             size_t *begin, size_t *end, bool cjk);

#endif
