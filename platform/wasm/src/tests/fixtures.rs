//! Raw-source fixtures for the engine suites.
//!
//! Keep sources small: snapshots of frame geometry grow fast, and a fixture
//! that fits in one paragraph is enough to exercise a partition decision.

/// One named raw source.
pub struct Fixture {
    pub name: &'static str,
    pub source: &'static str,
}

pub const PLAIN: &str =
    "Hello, *world*.\n\nA second paragraph with `code` and a\nline break inside it.\n";

pub const STRUCTURE: &str = "\
#set par(justify: true)
= Title

Body after the heading.

- one
- two
  - nested

+ step
+ step

| a | b |
|---|---|
| 1 | 2 |

// a comment
#let x = 1
#set text(size: 12pt)
Paragraph with #x and a #link(\"https://typbase.at\")[link].
";

pub const MATH_OK: &str = "\
Inline $x^2 + y^2 = z^2$ stays inline.

$ integral_0^1 x dif x = 1/2 $
";

pub const MATH_BROKEN_CALL: &str = "\
Before the equation.

$ integral.triple dif x $

After the equation.
";

pub const MATH_BROKEN_IDENT: &str = "\
Before.

$ notdefined + 1 $

After.
";

pub const MATH_BROKEN_CALL_UNDEFINED: &str = "\
Before.

$ notdefined(x) $

After.
";

pub const MATH_UNCLOSED_DOLLAR: &str = "\
Before.

$ x + y

After paragraph.
";

pub const MATH_UNCLOSED_QUOTE: &str = "\
Before.

$ \"abc > 3 $

After paragraph.
";

pub const MATH_EMPTY_QUOTES: &str = "\
Before.

$ \"\"\" $

After paragraph.
";

pub const MATH_EMPTY_SUB_CALL: &str = "\
Before.

$ abs((x_)) $

After.
";

pub const MATH_EMPTY_SUP_CALL: &str = "\
Before.

$ abs((x^)) $

After.
";

pub const MATH_EMPTY_SUB: &str = "\
Before.

$ abs(x_) $

After.
";

pub const MATH_SUB_PAREN: &str = "\
Before.

$ f(x)_1 $

After.
";

pub const MATH_SUP_PAREN: &str = "\
Before.

$ (a + b)^2 $

After.
";

pub const MATH_ALIGN_PAREN: &str = "\
Before.

$ & (x + y) &= z $

After.
";

pub const MATH_UNCLOSED_PAREN: &str = "\
Before.

$ f(x $

After.
";

pub const MATH_MIXED_ERRORS: &str = "\
Intro $ notdefined $ sentence.

$ integral.triple dif x $

$ x + y
";

/// Every non-error fixture, in order. Used for partition/tooltip snapshots
/// without recovery.
pub const CLEAN: &[Fixture] = &[
    Fixture {
        name: "plain",
        source: PLAIN,
    },
    Fixture {
        name: "structure",
        source: STRUCTURE,
    },
    Fixture {
        name: "math_ok",
        source: MATH_OK,
    },
];

/// Math fixtures that should render through recovery instead of failing the
/// whole document.
pub const BROKEN_MATH: &[Fixture] = &[
    Fixture {
        name: "math_broken_call",
        source: MATH_BROKEN_CALL,
    },
    Fixture {
        name: "math_broken_ident",
        source: MATH_BROKEN_IDENT,
    },
    Fixture {
        name: "math_broken_call_undefined",
        source: MATH_BROKEN_CALL_UNDEFINED,
    },
    Fixture {
        name: "math_unclosed_dollar",
        source: MATH_UNCLOSED_DOLLAR,
    },
    Fixture {
        name: "math_unclosed_quote",
        source: MATH_UNCLOSED_QUOTE,
    },
    Fixture {
        name: "math_empty_quotes",
        source: MATH_EMPTY_QUOTES,
    },
    Fixture {
        name: "math_empty_sub_call",
        source: MATH_EMPTY_SUB_CALL,
    },
    Fixture {
        name: "math_empty_sup_call",
        source: MATH_EMPTY_SUP_CALL,
    },
    Fixture {
        name: "math_empty_sub",
        source: MATH_EMPTY_SUB,
    },
    Fixture {
        name: "math_sub_paren",
        source: MATH_SUB_PAREN,
    },
    Fixture {
        name: "math_sup_paren",
        source: MATH_SUP_PAREN,
    },
    Fixture {
        name: "math_align_paren",
        source: MATH_ALIGN_PAREN,
    },
    Fixture {
        name: "math_unclosed_paren",
        source: MATH_UNCLOSED_PAREN,
    },
    Fixture {
        name: "math_mixed_errors",
        source: MATH_MIXED_ERRORS,
    },
];

/// Sources that stress the offset maps: dropped leading whitespace, multibyte
/// text, CRLF, missing trailing newlines, empty documents, and multiple errors
/// in one equation. These are not part of the snapshot suites.
pub const ADVERSARIAL: &[Fixture] = &[
    Fixture {
        name: "leading_blank",
        source: "\n\nHello after blank lines.\n",
    },
    Fixture {
        name: "leading_comment",
        source: "// a comment\n\nHello after the comment.\n",
    },
    Fixture {
        name: "unicode",
        source: "Héllo wörld 😀 and $x^2$ here.\n\nSecond paragraph with a label <tab>.\n",
    },
    Fixture {
        name: "crlf",
        source: "First line.\r\n\r\nSecond paragraph.\r\n",
    },
    Fixture {
        name: "no_trailing_newline",
        source: "No trailing newline",
    },
    Fixture {
        name: "structural_only",
        source: "#let x = 1\n#set text(size: 12pt)\n",
    },
    Fixture {
        name: "two_errors_one_equation",
        source: "Before.\n\n$ notdefined + alsoundefined $\n\nAfter.\n",
    },
    Fixture {
        name: "empty",
        source: "",
    },
    Fixture {
        name: "whitespace_only",
        source: "\n\n   \n",
    },
];
