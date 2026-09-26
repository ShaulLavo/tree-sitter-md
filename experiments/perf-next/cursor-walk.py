from pathlib import Path
p = Path('src/document.c')
t = p.read_text()
a = t.index('static uint64_t layout_key(')
b = t.index('static uint64_t leaf_key(', a)
t = t[:a] + '''static uint64_t layout_cursor(Document *d, TSTreeCursor *cursor, uint32_t base, uint64_t h) {
  if (!ts_tree_cursor_goto_first_child(cursor))
    return h;
  do {
    TSNode c = ts_tree_cursor_current_node(cursor);
    if (!ts_node_is_named(c))
      continue;
    if (is(c, d->ids.block_continuation))
      h = mix(h, (start(c) - base) | (uint64_t)(end(c) - base) << 32);
    else if (ts_node_named_child_count(c))
      h = layout_cursor(d, cursor, base, h);
  } while (ts_tree_cursor_goto_next_sibling(cursor));
  ts_tree_cursor_goto_parent(cursor);
  return h;
}
static uint64_t layout_key(Document *d, TSNode node, uint32_t base, uint64_t h) {
  uint32_t count = ts_node_named_child_count(node);
  if (count <= 16) {
    for (uint32_t i = 0; i < count; i++) {
      TSNode c = ts_node_named_child(node, i);
      if (is(c, d->ids.block_continuation))
        h = mix(h, (start(c) - base) | (uint64_t)(end(c) - base) << 32);
      else if (ts_node_named_child_count(c))
        h = layout_key(d, c, base, h);
    }
    return h;
  }
  TSTreeCursor cursor = ts_tree_cursor_new(node);
  h = layout_cursor(d, &cursor, base, h);
  ts_tree_cursor_delete(&cursor);
  return h;
}
''' + t[b:]
a = t.index('  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {', t.index('static void table('))
b = t.index('  while (last > start(node)', a)
t = t[:a] + '''  TSTreeCursor cursor = ts_tree_cursor_new(node);
  if (ts_tree_cursor_goto_first_child(&cursor)) {
    do {
      TSNode row = ts_tree_cursor_current_node(&cursor);
      if (!ts_node_is_named(row) || is(row, d->ids.block_continuation))
        continue;
      last = end(row);
      split_cells(d, start(row), last, &cells);
      bool delimiter = is(row, d->ids.pipe_table_delimiter_row);
      if (delimiter)
        columns = cells.n / 2;
      aligns |= table_cells(d, &cells, delimiter, out, deps);
    } while (ts_tree_cursor_goto_next_sibling(&cursor));
  }
  ts_tree_cursor_delete(&cursor);
''' + t[b:]
p.write_text(t)
p = Path('src/leaf.c')
t = p.read_text()
a = t.index('  count = ts_node_named_child_count(in);')
b = t.index('  push_lines(d, a, b, &line_start);', a)
t = t[:a] + '''  count = ts_node_named_child_count(in);
  if (count <= 16) {
    for (uint32_t i = 0; i < count; i++) {
      TSNode c = ts_node_named_child(in, i);
      if (!is(c, d->ids.block_continuation))
        continue;
      push_lines(d, a, start(c), &line_start);
      a = end(c);
    }
  } else {
    TSTreeCursor cursor = ts_tree_cursor_new(in);
    if (ts_tree_cursor_goto_first_child(&cursor)) {
      do {
        TSNode c = ts_tree_cursor_current_node(&cursor);
        if (!ts_node_is_named(c) || !is(c, d->ids.block_continuation))
          continue;
        push_lines(d, a, start(c), &line_start);
        a = end(c);
      } while (ts_tree_cursor_goto_next_sibling(&cursor));
    }
    ts_tree_cursor_delete(&cursor);
  }
''' + t[b:]
p.write_text(t)
