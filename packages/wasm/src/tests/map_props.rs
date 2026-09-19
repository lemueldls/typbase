//! Seeded property checks for the offset maps and the delimiter repair.
//! These generate arbitrary edits and inputs instead of hand-picked cases, so
//! an invariant break shows up as a failing seed.

use crate::source::{RawFixups, SegmentKind, Side, SourceMap, find_fixes};

/// Deterministic xorshift32, so a failure reproduces from the seed.
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.0 = value;
        value
    }

    fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            0
        } else {
            self.next() as usize % bound
        }
    }
}

/// The full contract every map must satisfy, independent of the lookup
/// implementation.
fn check_map(map: &SourceMap, from: &str, to: &str) {
    let problems = map.validate();
    assert!(problems.is_empty(), "{problems:#?}");
    assert_eq!(map.from_len(), from.len());
    assert_eq!(map.to_len(), to.len());

    let mut last_before = 0;
    let mut last_after = 0;
    for offset in 0..=from.len() {
        let before = map.forward(offset, Side::Before);
        let after = map.forward(offset, Side::After);

        assert!(before <= after, "sides crossed at {offset}");
        assert!(after <= to.len(), "forward({offset}) escaped");
        assert!(
            before >= last_before && after >= last_after,
            "forward regressed at {offset}",
        );

        last_before = before;
        last_after = after;
    }

    let mut last = 0;
    for offset in 0..=to.len() {
        let source = map.backward(offset);

        assert!(source <= from.len(), "backward({offset}) escaped");
        assert!(source >= last, "backward regressed at {offset}");

        last = source;
    }
}

#[test]
fn random_text_repairs_are_sound() {
    let alphabet = [
        "a", "b", " ", "\n", "$", "\"", "_", "^", "(", ")", "1", "*", "\r\n",
    ];
    let mut rng = Rng(0x1234_5678);

    for round in 0..128 {
        let length = rng.below(48);
        let mut text = String::new();

        for _ in 0..length {
            text.push_str(alphabet[rng.below(alphabet.len())]);
        }

        let fixes = find_fixes(&text);
        let fixups = RawFixups::new(fixes.clone(), text.len());
        let repaired = fixups.repaired(&text);

        let expected = text.len() + fixes.iter().map(|fix| fix.insertion.len()).sum::<usize>();
        assert_eq!(repaired.len(), expected, "round {round}: {text:?}");

        check_map(fixups.map(), &text, &repaired);
    }
}

#[test]
fn random_edits_keep_maps_sound() {
    let from = "abcdefghij";
    let mut rng = Rng(0xDEAD_BEEF);

    for round in 0..64 {
        let mut map = SourceMap::identity(from.len());
        let mut to = from.to_string();
        let mut history: Vec<String> = Vec::new();

        for _ in 0..4 {
            if rng.next() % 2 == 0 {
                let at = rng.below(to.len() + 1);
                let text = ["X", "yz", ""][rng.below(3)];

                history.push(format!("insert at {at} {text:?} to={to:?}"));
                map.insert(at, text, SegmentKind::Unknown);
                to.insert_str(at, text);
            } else {
                let start = rng.below(to.len().max(1));
                let end = start + rng.below(to.len() - start + 1);
                let text = ["", "Q", "rs"][rng.below(3)];

                history.push(format!("replace {start}..{end} {text:?} to={to:?}"));
                map.replace(start..end, text, SegmentKind::Unknown);
                to.replace_range(start..end, text);
            }
        }

        let problems = map.validate();
        assert!(
            problems.is_empty(),
            "round {round}: {history:#?}\nsegments: {:#?}\nto: {to:?}",
            map.segments(),
        );

        check_map(&map, from, &to);
    }
}

#[test]
fn delimiter_fixes_are_deterministic() {
    let text = "$ \"abc > 3 $\n\n$ x_ + y^\n";
    let first = find_fixes(text);
    let second = find_fixes(text);

    assert_eq!(first, second);

    let fixups = RawFixups::new(first, text.len());
    assert!(!fixups.is_empty());
    assert!(fixups.map().validate().is_empty());
}

/// Every insertion lands at a raw offset inside the text.
#[test]
fn delimiter_fixes_stay_inside_the_text() {
    let mut rng = Rng(0x0BAD_F00D);
    let alphabet = ["$", "\"", "x", " ", "\n", "_"];

    for _ in 0..64 {
        let mut text = String::new();
        for _ in 0..rng.below(24) {
            text.push_str(alphabet[rng.below(alphabet.len())]);
        }

        for fix in find_fixes(&text) {
            assert!(
                fix.raw_offset <= text.len(),
                "fix at {} outside {text:?}",
                fix.raw_offset,
            );
            assert!(!fix.insertion.is_empty());
        }
    }
}
