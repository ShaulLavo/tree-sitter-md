// The math grammar adds concrete flow math to the upstream-derived base block grammar.
// The base language and its lazy paragraph ownership remain unchanged.
module.exports = grammar(require('../grammar'), {
    name: 'markdown_math',
    rules: {
        _block_not_section: ($, original) => choice(original, $.math_flow),
        math_flow: $ => prec.right(choice(
            seq(
                alias($._math_flow_start, $.math_flow_delimiter),
                optional($.math_flow_meta),
                $._eof,
                $._block_close,
            ),
            seq(
                alias($._math_flow_start, $.math_flow_delimiter),
                optional($.math_flow_meta),
                $._newline,
                optional($.math_flow_content),
                optional(seq(alias($._math_flow_end, $.math_flow_delimiter), $._close_block, choice($._newline, $._eof))),
                $._block_close,
            ),
        )),
        math_flow_meta: $ => $._line,
        math_flow_content: $ => repeat1(choice($._newline, $._line)),
    },
    externals: ($, original) => original.concat([$._math_flow_start, $._math_flow_end]),
});
