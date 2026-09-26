#include "resolver.h"
static void cap(Words *v, uint32_t a, uint32_t b, uint32_t c) {
  if (a >= b)
    return;
  word(v, a);
  word(v, b);
  word(v, c);
}
static void link_caps(Document *d, uint32_t at, uint32_t s, uint32_t e) {
  uint32_t *label = NULL;
  for (uint32_t i = at + 4; i < d->spare.n; i += 4) {
    uint32_t *r = d->spare.v + i;
    if (r[0] >= e)
      break;
    if (r[2] == LINK_TEXT && r[0] >= s && r[1] <= e) {
      label = r;
      break;
    }
  }
  if (!label || d->text[s] == '<') {
    cap(&d->out, s, e, 5);
    return;
  }
  uint32_t a = label[0], b = label[1];
  cap(&d->out, s, a, 4);
  cap(&d->out, a, b, 6);
  if (b < e && d->text[b] == ']')
    cap(&d->out, b, b + 1, 4);
  if (b + 1 < e && d->text[b + 1] == '(') {
    cap(&d->out, b + 1, b + 2, 4);
    cap(&d->out, b + 2, e - 1, 5);
    cap(&d->out, e - 1, e, 4);
  }
}
static int compare_cap(const void *a, const void *b) {
  const uint32_t *x = a, *y = b;
  if (x[0] != y[0])
    return x[0] < y[0] ? -1 : 1;
  return x[1] == y[1] ? 0 : (x[1] > y[1] ? -1 : 1);
}
static void capture(Document *d, uint32_t i) {
  uint32_t *r = d->spare.v + i, s = r[0], e = r[1], kind = r[2], k = 0;
  switch (kind) {
  case H:
    while (e > s && (d->text[e - 1] == '\n' || d->text[e - 1] == '\r'))
      e--;
    cap(&d->out, s, e, 1);
    break;
  case HEADING_MARK:
  case LIST_MARK:
  case QUOTE_MARK:
  case HR:
    cap(&d->out, s, e, 2);
    break;
  case CODE:
    if (!r[3])
      cap(&d->out, s, e, 3);
    break;
  case INFO:
    cap(&d->out, s, e, 3);
    break;
  case FENCE_MARK:
    cap(&d->out, s, e, 4);
    break;
  case CSPAN:
    while (s + k < e && d->text[s + k] == '`')
      k++;
    cap(&d->out, s, e, 3);
    cap(&d->out, s, s + k, 4);
    cap(&d->out, e - k, e, 4);
    break;
  case EM:
  case STRONG:
  case DEL:
    while (s + k < e && d->text[s + k] == d->text[s] && k < 2)
      k++;
    if (kind == EM)
      k = 1;
    if (kind != DEL)
      cap(&d->out, s, e, kind == EM ? 8 : 9);
    cap(&d->out, s, s + k, 4);
    cap(&d->out, e - k, e, 4);
    break;
  case A:
  case IMG:
    link_caps(d, i, s, e);
    break;
  case BR:
    cap(&d->out, s, e, 7);
    break;
  }
}
void highlights(Document *d) {
  Words temp = d->spare;
  d->spare = d->out;
  d->out = temp;
  d->out.n = 0;
  for (uint32_t i = 0; i < d->spare.n; i += 4)
    capture(d, i);
  qsort(d->out.v, d->out.n / 3, 3 * sizeof(uint32_t), compare_cap);
}
