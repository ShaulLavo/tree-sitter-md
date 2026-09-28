// Block structure of CommonMark + GFM for tree-sitter-md.
//
// Forked from tree-sitter-grammars/tree-sitter-markdown v0.5.3 (MIT, Matthias Deiml; see
// licenses/tree-sitter-markdown.txt). What changed:
//
// - Text is one token per line (`_text`), not one per word. Upstream's per-word `repeat1` made
//   every paragraph a chain of fragile nodes that incremental reparses could not reuse.
// - Link reference definitions are paragraph content. CommonMark defines them that way, and the
//   Rust resolver strips them from the start of each paragraph.
// - The info string, table rows and cells are single tokens; the resolver reads them.
// - HTML blocks of kinds 1-5 keep word tokens, because their end condition is a substring.
// - Optional frontmatter is excluded by the document owner before block parsing.
// - The external scanner (src/scanner.c) is upstream's with two changes: ASCII character classes
//   in place of libc's (it builds for wasm32-unknown-unknown), and `textarea` in HTML block 1
//   (CommonMark 0.31).

/// <reference types="tree-sitter-cli/dsl" />

const common = require('./common/common');

const PUNCTUATION_CHARACTERS_REGEX = '!-/:-@\\[-`\\{-~';

module.exports = grammar({
    name: 'markdown',

    rules: {
        document: $ => seq(
            alias(prec.right(repeat($._block_not_section)), $.section),
            repeat($.section),
        ),

        _block: $ => choice(
            $._block_not_section,
            $.section,
        ),
        _block_not_section: $ => choice(
            alias($._setext_heading1, $.setext_heading),
            alias($._setext_heading2, $.setext_heading),
            $.paragraph,
            $.indented_code_block,
            $.block_quote,
            $.thematic_break,
            $.list,
            $.fenced_code_block,
            $._blank_line,
            $.html_block,
            $.pipe_table,
        ),
        section: $ => choice($._section1, $._section2, $._section3, $._section4, $._section5, $._section6),
        _section1: $ => prec.right(seq(
            alias($._atx_heading1, $.atx_heading),
            repeat(choice(
                alias(choice($._section6, $._section5, $._section4, $._section3, $._section2), $.section),
                $._block_not_section
            ))
        )),
        _section2: $ => prec.right(seq(
            alias($._atx_heading2, $.atx_heading),
            repeat(choice(
                alias(choice($._section6, $._section5, $._section4, $._section3), $.section),
                $._block_not_section
            ))
        )),
        _section3: $ => prec.right(seq(
            alias($._atx_heading3, $.atx_heading),
            repeat(choice(
                alias(choice($._section6, $._section5, $._section4), $.section),
                $._block_not_section
            ))
        )),
        _section4: $ => prec.right(seq(
            alias($._atx_heading4, $.atx_heading),
            repeat(choice(
                alias(choice($._section6, $._section5), $.section),
                $._block_not_section
            ))
        )),
        _section5: $ => prec.right(seq(
            alias($._atx_heading5, $.atx_heading),
            repeat(choice(
                alias($._section6, $.section),
                $._block_not_section
            ))
        )),
        _section6: $ => prec.right(seq(
            alias($._atx_heading6, $.atx_heading),
            repeat($._block_not_section)
        )),

        // LEAF BLOCKS

        thematic_break: $ => seq($._thematic_break, choice($._newline, $._eof)),

        _atx_heading1: $ => prec(1, seq($.atx_h1_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading2: $ => prec(1, seq($.atx_h2_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading3: $ => prec(1, seq($.atx_h3_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading4: $ => prec(1, seq($.atx_h4_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading5: $ => prec(1, seq($.atx_h5_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading6: $ => prec(1, seq($.atx_h6_marker, optional($._atx_heading_content), $._newline)),
        _atx_heading_content: $ => field('heading_content', alias($._line, $.inline)),

        _setext_heading1: $ => seq(
            field('heading_content', $.paragraph),
            $.setext_h1_underline,
            choice($._newline, $._eof),
        ),
        _setext_heading2: $ => seq(
            field('heading_content', $.paragraph),
            $.setext_h2_underline,
            choice($._newline, $._eof),
        ),

        indented_code_block: $ => prec.right(seq($._indented_chunk, repeat(choice($._indented_chunk, $._blank_line)))),
        _indented_chunk: $ => seq($._indented_chunk_start, repeat(choice($._line, $._newline)), $._block_close, optional($.block_continuation)),

        fenced_code_block: $ => prec.right(choice(
            seq(
                alias($._fenced_code_block_start_backtick, $.fenced_code_block_delimiter),
                optional($.info_string),
                $._newline,
                optional($.code_fence_content),
                optional(seq(alias($._fenced_code_block_end_backtick, $.fenced_code_block_delimiter), $._close_block, $._newline)),
                $._block_close,
            ),
            seq(
                alias($._fenced_code_block_start_tilde, $.fenced_code_block_delimiter),
                optional($.info_string),
                $._newline,
                optional($.code_fence_content),
                optional(seq(alias($._fenced_code_block_end_tilde, $.fenced_code_block_delimiter), $._close_block, $._newline)),
                $._block_close,
            ),
        )),
        code_fence_content: $ => repeat1(choice($._newline, $._line)),
        // The resolver reads the language (first word, escapes decoded) from the token.
        info_string: $ => $._line,

        html_block: $ => prec(1, seq(optional($._whitespace), choice(
            $._html_block_1,
            $._html_block_2,
            $._html_block_3,
            $._html_block_4,
            $._html_block_5,
            $._html_block_6,
            $._html_block_7,
        ))),
        _html_block_1: $ => build_html_block($, $._html_block_1_start, $._html_block_1_end, $._word_line),
        _html_block_2: $ => build_html_block($, $._html_block_2_start, '-->', $._word_line),
        _html_block_3: $ => build_html_block($, $._html_block_3_start, '?>', $._word_line),
        _html_block_4: $ => build_html_block($, $._html_block_4_start, '>', $._word_line),
        _html_block_5: $ => build_html_block($, $._html_block_5_start, ']]>', $._word_line),
        _html_block_6: $ => build_html_block($, $._html_block_6_start, seq($._newline, $._blank_line), $._line),
        _html_block_7: $ => build_html_block($, $._html_block_7_start, seq($._newline, $._blank_line), $._line),

        // The scanner decides where a paragraph ends (see upstream's notes on `$._split_token`).
        paragraph: $ => seq(alias($._paragraph_lines, $.inline), choice($._newline, $._eof)),
        _paragraph_lines: $ => repeat1(choice($._line, $._soft_line_break)),

        _blank_line: $ => seq($._blank_line_start, choice($._newline, $._eof)),

        // CONTAINER BLOCKS

        block_quote: $ => seq(
            alias($._block_quote_start, $.block_quote_marker),
            optional($.block_continuation),
            repeat($._block),
            $._block_close,
            optional($.block_continuation)
        ),

        list: $ => prec.right(choice(
            $._list_plus,
            $._list_minus,
            $._list_star,
            $._list_dot,
            $._list_parenthesis
        )),
        _list_plus: $ => prec.right(repeat1(alias($._list_item_plus, $.list_item))),
        _list_minus: $ => prec.right(repeat1(alias($._list_item_minus, $.list_item))),
        _list_star: $ => prec.right(repeat1(alias($._list_item_star, $.list_item))),
        _list_dot: $ => prec.right(repeat1(alias($._list_item_dot, $.list_item))),
        _list_parenthesis: $ => prec.right(repeat1(alias($._list_item_parenthesis, $.list_item))),
        list_marker_plus: $ => choice($._list_marker_plus, $._list_marker_plus_dont_interrupt),
        list_marker_minus: $ => choice($._list_marker_minus, $._list_marker_minus_dont_interrupt),
        list_marker_star: $ => choice($._list_marker_star, $._list_marker_star_dont_interrupt),
        list_marker_dot: $ => choice($._list_marker_dot, $._list_marker_dot_dont_interrupt),
        list_marker_parenthesis: $ => choice($._list_marker_parenthesis, $._list_marker_parenthesis_dont_interrupt),
        _list_item_plus: $ => list_item($, $.list_marker_plus),
        _list_item_minus: $ => list_item($, $.list_marker_minus),
        _list_item_star: $ => list_item($, $.list_marker_star),
        _list_item_dot: $ => list_item($, $.list_marker_dot),
        _list_item_parenthesis: $ => list_item($, $.list_marker_parenthesis),
        _list_item_content: $ => choice(
            prec(1, seq(
                $._blank_line,
                $._blank_line,
                $._close_block,
                optional($.block_continuation)
            )),
            repeat1($._block),
            prec(1, seq(
                choice($.task_list_marker_checked, $.task_list_marker_unchecked),
                $._whitespace,
                $.paragraph,
                repeat($._block)
            )),
        ),

        _newline: $ => seq(
            $._line_ending,
            optional($.block_continuation)
        ),
        _soft_line_break: $ => seq(
            $._soft_line_ending,
            optional($.block_continuation)
        ),

        // One line of text. A line cannot start with a token that begins with `[`, so that
        // `[x]` still lexes as a task marker where one is valid.
        _line: $ => prec.right(choice(seq($._brackets, optional($._text)), $._text)),
        _brackets: $ => /\[+/,
        _text: $ => /[^\[\r\n][^\r\n]*/,

        // Word tokens, for the HTML blocks whose end condition can sit anywhere in a line.
        _word_line: $ => prec.right(repeat1(choice($._word, $._whitespace, common.punctuation_without($, [])))),
        _word: $ => new RegExp('[^' + PUNCTUATION_CHARACTERS_REGEX + ' \\t\\n\\r]+'),
        _last_token_punctuation: $ => choice(),
        _whitespace: $ => /[ \t]+/,

        task_list_marker_checked: $ => prec(1, /\[[xX]\]/),
        task_list_marker_unchecked: $ => prec(1, /\[[ \t]\]/),

        // Rows are single tokens; the resolver splits cells and reads alignment.
        pipe_table: $ => prec.right(seq(
            $._pipe_table_start,
            alias($.pipe_table_row, $.pipe_table_header),
            $._newline,
            alias($.pipe_table_row, $.pipe_table_delimiter_row),
            repeat(seq($._pipe_table_newline, optional($.pipe_table_row))),
            choice($._newline, $._eof),
        )),
        _pipe_table_newline: $ => seq(
            $._pipe_table_line_ending,
            optional($.block_continuation)
        ),
        pipe_table_row: $ => $._line,
    },

    // Same order as upstream: the scanner indexes valid symbols by position.
    externals: $ => [
        $._line_ending,
        $._soft_line_ending,
        $._block_close,
        $.block_continuation,
        $._block_quote_start,
        $._indented_chunk_start,
        $.atx_h1_marker,
        $.atx_h2_marker,
        $.atx_h3_marker,
        $.atx_h4_marker,
        $.atx_h5_marker,
        $.atx_h6_marker,
        $.setext_h1_underline,
        $.setext_h2_underline,
        $._thematic_break,
        $._list_marker_minus,
        $._list_marker_plus,
        $._list_marker_star,
        $._list_marker_parenthesis,
        $._list_marker_dot,
        $._list_marker_minus_dont_interrupt,
        $._list_marker_plus_dont_interrupt,
        $._list_marker_star_dont_interrupt,
        $._list_marker_parenthesis_dont_interrupt,
        $._list_marker_dot_dont_interrupt,
        $._fenced_code_block_start_backtick,
        $._fenced_code_block_start_tilde,
        $._blank_line_start,
        $._fenced_code_block_end_backtick,
        $._fenced_code_block_end_tilde,
        $._html_block_1_start,
        $._html_block_1_end,
        $._html_block_2_start,
        $._html_block_3_start,
        $._html_block_4_start,
        $._html_block_5_start,
        $._html_block_6_start,
        $._html_block_7_start,
        $._close_block,
        $._no_indented_chunk,
        $._error,
        $._trigger_error,
        $._eof,
        $.minus_metadata,
        $.plus_metadata,
        $._pipe_table_start,
        $._pipe_table_line_ending,
    ],
    precedences: $ => [
        [$._setext_heading1, $._block],
        [$._setext_heading2, $._block],
        [$.indented_code_block, $._block],
    ],
    extras: $ => [],
});

function list_item($, marker) {
    return seq(
        marker,
        optional($.block_continuation),
        $._list_item_content,
        $._block_close,
        optional($.block_continuation)
    );
}

function build_html_block($, open, close, line) {
    return seq(
        open,
        repeat(choice(
            line,
            $._newline,
            seq(close, $._close_block),
        )),
        $._block_close,
        optional($.block_continuation),
    );
}
