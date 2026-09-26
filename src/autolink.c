// Adapted from github/cmark-gfm extensions/autolink.c. See licenses/cmark-gfm.txt.
#include "cmark_ctype.h"
#include "resolver.h"
#include "utf8.h"
#include <strings.h>
static int cmark_isalnum(uint8_t c) { return cmark_isalpha(c) || cmark_isdigit(c); }
static int cmark_utf8proc_is_punct(int32_t uc) {
  return (
      (uc < 128 && cmark_ispunct((char)uc)) || uc == 161 || uc == 167 || uc == 171 || uc == 182 ||
      uc == 183 || uc == 187 || uc == 191 || uc == 894 || uc == 903 || (uc >= 1370 && uc <= 1375) ||
      uc == 1417 || uc == 1418 || uc == 1470 || uc == 1472 || uc == 1475 || uc == 1478 ||
      uc == 1523 || uc == 1524 || uc == 1545 || uc == 1546 || uc == 1548 || uc == 1549 ||
      uc == 1563 || uc == 1566 || uc == 1567 || (uc >= 1642 && uc <= 1645) || uc == 1748 ||
      (uc >= 1792 && uc <= 1805) || (uc >= 2039 && uc <= 2041) || (uc >= 2096 && uc <= 2110) ||
      uc == 2142 || uc == 2404 || uc == 2405 || uc == 2416 || uc == 2800 || uc == 3572 ||
      uc == 3663 || uc == 3674 || uc == 3675 || (uc >= 3844 && uc <= 3858) || uc == 3860 ||
      (uc >= 3898 && uc <= 3901) || uc == 3973 || (uc >= 4048 && uc <= 4052) || uc == 4057 ||
      uc == 4058 || (uc >= 4170 && uc <= 4175) || uc == 4347 || (uc >= 4960 && uc <= 4968) ||
      uc == 5120 || uc == 5741 || uc == 5742 || uc == 5787 || uc == 5788 ||
      (uc >= 5867 && uc <= 5869) || uc == 5941 || uc == 5942 || (uc >= 6100 && uc <= 6102) ||
      (uc >= 6104 && uc <= 6106) || (uc >= 6144 && uc <= 6154) || uc == 6468 || uc == 6469 ||
      uc == 6686 || uc == 6687 || (uc >= 6816 && uc <= 6822) || (uc >= 6824 && uc <= 6829) ||
      (uc >= 7002 && uc <= 7008) || (uc >= 7164 && uc <= 7167) || (uc >= 7227 && uc <= 7231) ||
      uc == 7294 || uc == 7295 || (uc >= 7360 && uc <= 7367) || uc == 7379 ||
      (uc >= 8208 && uc <= 8231) || (uc >= 8240 && uc <= 8259) || (uc >= 8261 && uc <= 8273) ||
      (uc >= 8275 && uc <= 8286) || uc == 8317 || uc == 8318 || uc == 8333 || uc == 8334 ||
      (uc >= 8968 && uc <= 8971) || uc == 9001 || uc == 9002 || (uc >= 10088 && uc <= 10101) ||
      uc == 10181 || uc == 10182 || (uc >= 10214 && uc <= 10223) || (uc >= 10627 && uc <= 10648) ||
      (uc >= 10712 && uc <= 10715) || uc == 10748 || uc == 10749 || (uc >= 11513 && uc <= 11516) ||
      uc == 11518 || uc == 11519 || uc == 11632 || (uc >= 11776 && uc <= 11822) ||
      (uc >= 11824 && uc <= 11842) || (uc >= 12289 && uc <= 12291) ||
      (uc >= 12296 && uc <= 12305) || (uc >= 12308 && uc <= 12319) || uc == 12336 || uc == 12349 ||
      uc == 12448 || uc == 12539 || uc == 42238 || uc == 42239 || (uc >= 42509 && uc <= 42511) ||
      uc == 42611 || uc == 42622 || (uc >= 42738 && uc <= 42743) || (uc >= 43124 && uc <= 43127) ||
      uc == 43214 || uc == 43215 || (uc >= 43256 && uc <= 43258) || uc == 43310 || uc == 43311 ||
      uc == 43359 || (uc >= 43457 && uc <= 43469) || uc == 43486 || uc == 43487 ||
      (uc >= 43612 && uc <= 43615) || uc == 43742 || uc == 43743 || uc == 43760 || uc == 43761 ||
      uc == 44011 || uc == 64830 || uc == 64831 || (uc >= 65040 && uc <= 65049) ||
      (uc >= 65072 && uc <= 65106) || (uc >= 65108 && uc <= 65121) || uc == 65123 || uc == 65128 ||
      uc == 65130 || uc == 65131 || (uc >= 65281 && uc <= 65283) || (uc >= 65285 && uc <= 65290) ||
      (uc >= 65292 && uc <= 65295) || uc == 65306 || uc == 65307 || uc == 65311 || uc == 65312 ||
      (uc >= 65339 && uc <= 65341) || uc == 65343 || uc == 65371 || uc == 65373 ||
      (uc >= 65375 && uc <= 65381) || (uc >= 65792 && uc <= 65794) || uc == 66463 || uc == 66512 ||
      uc == 66927 || uc == 67671 || uc == 67871 || uc == 67903 || (uc >= 68176 && uc <= 68184) ||
      uc == 68223 || (uc >= 68336 && uc <= 68342) || (uc >= 68409 && uc <= 68415) ||
      (uc >= 68505 && uc <= 68508) || (uc >= 69703 && uc <= 69709) || uc == 69819 || uc == 69820 ||
      (uc >= 69822 && uc <= 69825) || (uc >= 69952 && uc <= 69955) || uc == 70004 || uc == 70005 ||
      (uc >= 70085 && uc <= 70088) || uc == 70093 || (uc >= 70200 && uc <= 70205) || uc == 70854 ||
      (uc >= 71105 && uc <= 71113) || (uc >= 71233 && uc <= 71235) ||
      (uc >= 74864 && uc <= 74868) || uc == 92782 || uc == 92783 || uc == 92917 ||
      (uc >= 92983 && uc <= 92987) || uc == 92996 || uc == 113823);
}

static int is_valid_hostchar(const uint8_t *link, size_t link_len) {
  int32_t ch;
  int r = cmark_utf8proc_iterate(link, (bufsize_t)link_len, &ch);
  if (r < 0)
    return 0;
  return !cmark_utf8proc_is_space(ch) && !cmark_utf8proc_is_punct(ch);
}

static int sd_autolink_issafe(const uint8_t *link, size_t link_len) {
  static const size_t valid_uris_count = 2;
  static const char *valid_uris[] = {"http://", "https://"};

  size_t i;

  for (i = 0; i < valid_uris_count; ++i) {
    size_t len = strlen(valid_uris[i]);

    if (link_len > len && strncasecmp((char *)link, valid_uris[i], len) == 0 &&
        is_valid_hostchar(link + len, link_len - len))
      return 1;
  }

  return 0;
}

static size_t autolink_delim(uint8_t *data, size_t link_end) {
  size_t i;
  size_t closing = 0;
  size_t opening = 0;

  for (i = 0; i < link_end; ++i) {
    const uint8_t c = data[i];
    if (c == '<') {
      link_end = i;
      break;
    } else if (c == '(') {
      opening++;
    } else if (c == ')') {
      closing++;
    }
  }

  while (link_end > 0) {
    switch (data[link_end - 1]) {
    case ')':
      /* Allow any number of matching brackets (as recognised in copen/cclose)
       * at the end of the URL.  If there is a greater number of closing
       * brackets than opening ones, we remove one character from the end of
       * the link.
       *
       * Examples (input text => output linked portion):
       *
       *        http://www.pokemon.com/Pikachu_(Electric)
       *                => http://www.pokemon.com/Pikachu_(Electric)
       *
       *        http://www.pokemon.com/Pikachu_((Electric)
       *                => http://www.pokemon.com/Pikachu_((Electric)
       *
       *        http://www.pokemon.com/Pikachu_(Electric))
       *                => http://www.pokemon.com/Pikachu_(Electric)
       *
       *        http://www.pokemon.com/Pikachu_((Electric))
       *                => http://www.pokemon.com/Pikachu_((Electric))
       */
      if (closing <= opening) {
        return link_end;
      }
      closing--;
      link_end--;
      break;
    case '?':
    case '!':
    case '.':
    case ',':
    case ':':
    case '*':
    case '_':
    case '~':
    case '\'':
    case '"':
      link_end--;
      break;
    case ';': {
      if (link_end < 2)
        return 0;
      size_t new_end = link_end - 2;

      while (new_end > 0 && cmark_isalpha(data[new_end]))
        new_end--;

      if (new_end < link_end - 2 && data[new_end] == '&')
        link_end = new_end;
      else
        link_end--;
      break;
    }

    default:
      return link_end;
    }
  }

  return link_end;
}

static size_t check_domain(uint8_t *data, size_t size, int allow_short) {
  if (size < 2)
    return 0;
  size_t i, np = 0, uscore1 = 0, uscore2 = 0;

  /* The purpose of this code is to reject urls that contain an underscore
   * in one of the last two segments. Examples:
   *
   *   www.xxx.yyy.zzz     autolinked
   *   www.xxx.yyy._zzz    not autolinked
   *   www.xxx._yyy.zzz    not autolinked
   *   www._xxx.yyy.zzz    autolinked
   *
   * The reason is that domain names are allowed to include underscores,
   * but host names are not. See: https://stackoverflow.com/a/2183140
   */
  for (i = 1; i < size - 1; i++) {
    if (data[i] == '\\' && i < size - 2)
      i++;
    if (data[i] == '_')
      uscore2++;
    else if (data[i] == '.') {
      uscore1 = uscore2;
      uscore2 = 0;
      np++;
    } else if (!is_valid_hostchar(data + i, size - i) && data[i] != '-')
      break;
  }

  if (uscore1 > 0 || uscore2 > 0) {
    /* If the url is very long then accept it despite the underscores,
     * to avoid quadratic behavior causing a denial of service. See:
     * https://github.com/github/cmark-gfm/security/advisories/GHSA-29g3-96g3-jg6c
     * Reasonable urls are unlikely to have more than 10 segments, so
     * this extra condition shouldn't have any impact on normal usage.
     */
    if (np <= 10) {
      return 0;
    }
  }

  if (allow_short) {
    /* We don't need a valid domain in the strict sense (with
     * least one dot; so just make sure it's composed of valid
     * domain characters and return the length of the the valid
     * sequence. */
    return i;
  } else {
    /* a valid domain needs to have at least a dot.
     * that's as far as we get */
    return np ? i : 0;
  }
}

static bool email_protocol(uint8_t *data, size_t at, const char *protocol) {
  size_t n = strlen(protocol);
  if (at < n || strncasecmp((char *)data + at - n, protocol, n))
    return false;
  return at == n || !cmark_isalnum(data[at - n - 1]);
}
static size_t email_end(uint8_t *data, size_t size, size_t at, size_t *begin) {
  size_t a = at, b = at + 1, dots = 0;
  while (a > 0 && (cmark_isalnum(data[a - 1]) || strchr(".+-_", data[a - 1])))
    a--;
  if (a == at || (a > 0 && data[a - 1] == '/'))
    return 0;
  bool xmpp = email_protocol(data, a, "xmpp:");
  if (xmpp)
    a -= 5;
  else if (email_protocol(data, a, "mailto:"))
    a -= 7;
  while (b < size) {
    uint8_t c = data[b];
    if (c == '/' && xmpp) {
      b++;
      continue;
    }
    if (c == '.' && b + 1 < size && cmark_isalnum(data[b + 1]))
      dots++;
    else if (!cmark_isalnum(c) && c != '-' && c != '_')
      break;
    b++;
  }
  if (!dots || b <= at + 1 || !cmark_isalpha(data[b - 1]))
    return 0;
  *begin = a;
  return b;
}
void autolinks(Leaf *l, uint32_t a, uint32_t b, Words *out) {
  uint8_t *data = (uint8_t *)l->text + a;
  size_t size = b - a;
  for (size_t i = 0; i < size; i++) {
    size_t begin = i, finish = 0;
    if (data[i] == '@')
      finish = email_end(data, size, i, &begin);
    if (size - i >= 4 && !memcmp(data + i, "www.", 4) &&
        (!i || cmark_isspace(data[i - 1]) || strchr("*_~(", data[i - 1]))) {
      if (check_domain(data + i, size - i, 0))
        finish = i + 4;
    }
    if (data[i] == ':' && size - i > 3 && data[i + 1] == '/' && data[i + 2] == '/') {
      while (begin > 0 && cmark_isalpha(data[begin - 1]))
        begin--;
      if (sd_autolink_issafe(data + begin, size - begin) &&
          check_domain(data + i + 3, size - i - 3, 1))
        finish = i + 3;
    }
    if (!finish)
      continue;
    if (data[i] != '@') {
      while (finish < size && !cmark_isspace(data[finish]) && data[finish] != '<')
        finish++;
      finish = begin + autolink_delim(data + begin, finish - begin);
    }
    if (finish <= begin)
      continue;
    record(out, l->starts.v[a + begin], l->ends.v[a + finish - 1], A, 0);
    i = finish - 1;
  }
}
