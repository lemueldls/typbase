//! Byte-offset maps between two source texts.
//!
//! A [`SourceMap`] describes a target text built from a source text by copying
//! ranges verbatim and inserting generated text at source positions. It is the
//! single offset-translation primitive for the raw / repaired / synth / render
//! pipeline, replacing the old anchor-list `IndexMapper`.
//!
//! ## Why segments
//!
//! Segments tile the target text and carry the source coordinates they came
//! from. That makes both lookups total and monotone by construction:
//!
//! - [`SourceMap::forward`] walks source positions through the copies and
//!   picks a side at generated spans.
//! - [`SourceMap::backward`] walks target positions back to source positions;
//!   positions inside generated text clamp to the source position the text was
//!   inserted at.
//!
//! There is no sortedness precondition to violate: the segment list is built
//! in text order and every mutation re-establishes the tiling. Positions in
//! dropped source regions (leading blank lines, inter-block whitespace) clamp
//! to the adjacent segment boundary instead of extrapolating.
//!
//! ## Sides
//!
//! A source position exactly at a generated span is ambiguous: it is both the
//! end of the preceding copy and the start of the following one. Callers pick
//! with [`Side`]. Span mapping uses `After` for starts and `Before` for ends;
//! recovery that blanks a whole block uses `Before` for the start and `After`
//! for the end to include the generated wrappers.

use std::ops::Range;

/// Which side of a generated span a boundary position belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// Before the generated text, at the end of the preceding copy.
    Before,
    /// After the generated text, at the start of the following copy.
    After,
}

/// What a segment came from. Labels only; the mapper maps bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    /// Text copied from the source.
    Source,
    /// The generated document prelude.
    Prelude,
    /// A generated block wrapper (`#block(...)[` or `]`).
    Wrapper,
    /// A generated block separator newline.
    Separator,
    /// Generated vertical space for blank source lines.
    Spacing,
    /// An inserted delimiter repair.
    Fixup,
    /// A generated error mark or recovery placeholder.
    ErrorMark,
    /// No specific role known.
    Unknown,
}

impl SegmentKind {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Prelude => "prelude",
            Self::Wrapper => "wrapper",
            Self::Separator => "separator",
            Self::Spacing => "spacing",
            Self::Fixup => "fixup",
            Self::ErrorMark => "error-mark",
            Self::Unknown => "unknown",
        }
    }
}

/// A contiguous run of the target text with its source coordinates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    /// A range copied verbatim from the source.
    Copy {
        kind: SegmentKind,
        from: Range<usize>,
        to: Range<usize>,
    },
    /// Generated text anchored at a single source position.
    Generated {
        kind: SegmentKind,
        from: usize,
        to: Range<usize>,
    },
}

impl Segment {
    #[must_use]
    pub const fn kind(&self) -> SegmentKind {
        match self {
            Self::Copy { kind, .. } | Self::Generated { kind, .. } => *kind,
        }
    }

    #[must_use]
    pub const fn from_start(&self) -> usize {
        match self {
            Self::Copy { from, .. } => from.start,
            Self::Generated { from, .. } => *from,
        }
    }

    #[must_use]
    pub const fn from_end(&self) -> usize {
        match self {
            Self::Copy { from, .. } => from.end,
            Self::Generated { from, .. } => *from,
        }
    }

    #[must_use]
    pub const fn to_start(&self) -> usize {
        match self {
            Self::Copy { to, .. } | Self::Generated { to, .. } => to.start,
        }
    }

    #[must_use]
    pub const fn to_end(&self) -> usize {
        match self {
            Self::Copy { to, .. } | Self::Generated { to, .. } => to.end,
        }
    }

    #[must_use]
    pub const fn generated(&self) -> bool {
        matches!(self, Self::Generated { .. })
    }

    fn shift_to(&mut self, delta: isize) {
        match self {
            Self::Copy { to, .. } | Self::Generated { to, .. } => {
                to.start = to.start.checked_add_signed(delta).unwrap_or(0);
                to.end = to.end.checked_add_signed(delta).unwrap_or(0);
            }
        }
    }

    /// The part of this segment whose target range is `to`.
    fn truncated_to(&self, to: Range<usize>) -> Self {
        match self {
            Self::Copy { kind, from, .. } => {
                let offset = to.start.saturating_sub(self.to_start());
                Self::Copy {
                    kind: *kind,
                    from: from.start + offset..from.start + offset + (to.end - to.start),
                    to,
                }
            }
            Self::Generated { kind, from, .. } => Self::Generated {
                kind: *kind,
                from: *from,
                to,
            },
        }
    }
}

/// A monotone byte map between two source texts.
#[derive(Debug, Default, Clone)]
pub struct SourceMap {
    /// Generated text before the first source byte, such as the document
    /// prelude. Source position 0 maps to `prefix` when approached from
    /// [`Side::Before`], so callers never select the prefix by accident.
    prefix: usize,
    segments: Vec<Segment>,
    from_len: usize,
    to_len: usize,
}

impl SourceMap {
    /// The identity map over `len` bytes.
    #[must_use]
    pub fn identity(len: usize) -> Self {
        if len == 0 {
            return Self::default();
        }

        Self {
            prefix: 0,
            segments: vec![Segment::Copy {
                kind: SegmentKind::Source,
                from: 0..len,
                to: 0..len,
            }],
            from_len: len,
            to_len: len,
        }
    }

    /// Builds a map from a sorted list of insertions at source offsets.
    ///
    /// `insertions` pairs each source offset with the text inserted there.
    /// Multiple insertions at the same offset merge into one generated span.
    #[must_use]
    pub fn from_insertions(
        from_len: usize,
        insertions: &[(usize, &str)],
        kind: SegmentKind,
    ) -> Self {
        let mut segments = Vec::new();
        let mut from_cursor = 0;
        let mut to_cursor = 0;

        for (offset, text) in insertions {
            let offset = (*offset).min(from_len);
            if offset > from_cursor {
                segments.push(Segment::Copy {
                    kind: SegmentKind::Source,
                    from: from_cursor..offset,
                    to: to_cursor..to_cursor + (offset - from_cursor),
                });
                to_cursor += offset - from_cursor;
                from_cursor = offset;
            }

            if text.is_empty() {
                continue;
            }

            match segments.last_mut() {
                Some(Segment::Generated { from, to, .. }) if *from == offset => {
                    to.end += text.len();
                }
                _ => segments.push(Segment::Generated {
                    kind,
                    from: offset,
                    to: to_cursor..to_cursor + text.len(),
                }),
            }
            to_cursor += text.len();
        }

        if from_cursor < from_len {
            segments.push(Segment::Copy {
                kind: SegmentKind::Source,
                from: from_cursor..from_len,
                to: to_cursor..to_cursor + (from_len - from_cursor),
            });
            to_cursor += from_len - from_cursor;
        }

        Self {
            prefix: 0,
            segments,
            from_len,
            to_len: to_cursor,
        }
    }

    #[must_use]
    pub fn segments(&self) -> &[Segment] {
        &self.segments
    }

    /// Length of the generated prefix, such as the prelude.
    #[must_use]
    pub const fn prefix_len(&self) -> usize {
        self.prefix
    }

    #[must_use]
    pub const fn from_len(&self) -> usize {
        self.from_len
    }

    #[must_use]
    pub const fn to_len(&self) -> usize {
        self.to_len
    }

    #[must_use]
    pub fn is_identity(&self) -> bool {
        self.prefix == 0
            && self.from_len == self.to_len
            && match self.segments.as_slice() {
                [] => true,
                [Segment::Copy { from, to, .. }] => {
                    from.start == 0
                        && from.end == self.from_len
                        && to.start == 0
                        && to.end == self.to_len
                }
                _ => false,
            }
    }

    /// Maps a source offset to a target offset.
    ///
    /// Positions inside a copy map exactly. Positions at a generated span pick
    /// the side. Positions in dropped source regions (gaps between segments)
    /// clamp to the adjacent boundary. Source position 0 maps to
    /// [`Self::prefix_len`] under [`Side::Before`], never into the prefix.
    #[must_use]
    pub fn forward(&self, from: usize, side: Side) -> usize {
        let from = from.min(self.from_len);

        let index = self
            .segments
            .partition_point(|segment| segment.from_start() <= from);

        if index == 0 {
            return self.segments.first().map_or(self.prefix, Segment::to_start);
        }

        let segment = &self.segments[index - 1];

        match segment {
            Segment::Copy {
                from: range, to, ..
            } if from < range.end => {
                if from == range.start {
                    // Generated text may sit immediately before this copy at
                    // the same source position. Before picks the start of that
                    // group; after picks the copy start.
                    let mut start = to.start;
                    for earlier in self.segments[..index - 1].iter().rev() {
                        match earlier {
                            Segment::Generated {
                                from: point, to, ..
                            } if *point == from => {
                                start = to.start;
                            }
                            _ => break,
                        }
                    }
                    match side {
                        Side::Before => start,
                        Side::After => to.start,
                    }
                } else {
                    to.start + (from - range.start)
                }
            }
            Segment::Copy { to, .. } => to.end,
            Segment::Generated {
                from: point, to, ..
            } if from == *point => match side {
                Side::Before => {
                    let mut start = to.start;
                    for earlier in self.segments[..index - 1].iter().rev() {
                        match earlier {
                            Segment::Generated {
                                from: point, to, ..
                            } if *point == from => {
                                start = to.start;
                            }
                            _ => break,
                        }
                    }
                    start
                }
                Side::After => {
                    let mut end = to.end;
                    for later in &self.segments[index..] {
                        match later {
                            Segment::Generated {
                                from: point, to, ..
                            } if *point == from => {
                                end = to.end;
                            }
                            _ => break,
                        }
                    }
                    end
                }
            },
            Segment::Generated { to, .. } => to.end,
        }
    }

    /// Maps a target offset back to a source offset.
    ///
    /// Positions inside the prefix or generated text clamp to the source
    /// position the text was inserted at.
    #[must_use]
    pub fn backward(&self, to: usize) -> usize {
        let to = to.min(self.to_len);

        if to < self.prefix {
            return 0;
        }

        let index = self
            .segments
            .partition_point(|segment| segment.to_end() <= to);

        let Some(segment) = self.segments.get(index) else {
            return self.segments.last().map_or(0, Segment::from_end);
        };

        match segment {
            Segment::Copy {
                from, to: range, ..
            } => from.start + (to - range.start),
            Segment::Generated { from, .. } => *from,
        }
    }

    /// Inserts generated text at a target offset, splitting a copy if needed.
    pub fn insert(&mut self, to_at: usize, text: &str, kind: SegmentKind) {
        if text.is_empty() {
            return;
        }

        let to_at = to_at.max(self.prefix).min(self.to_len);
        let from_at = self.backward(to_at);

        if let Some(index) = self
            .segments
            .iter()
            .position(|segment| segment.to_start() < to_at && to_at < segment.to_end())
        {
            match self.segments[index].clone() {
                Segment::Copy { kind, from, to } => {
                    let offset = to_at - to.start;
                    let left = Segment::Copy {
                        kind,
                        from: from.start..from.start + offset,
                        to: to.start..to_at,
                    };
                    let right = Segment::Copy {
                        kind,
                        from: from.start + offset..from.end,
                        to: to_at..to.end,
                    };
                    self.segments.splice(index..=index, [left, right]);
                }
                Segment::Generated { .. } => {
                    // The insertion lands inside generated text, which all
                    // maps to the same source position. Extending the span is
                    // enough.
                    if let Some(Segment::Generated { to, .. }) = self.segments.get_mut(index) {
                        to.end += text.len();
                    }
                    let delta = text.len() as isize;
                    for segment in &mut self.segments[index + 1..] {
                        segment.shift_to(delta);
                    }
                    self.to_len += text.len();
                    return;
                }
            }
        }

        let index = self
            .segments
            .partition_point(|segment| segment.to_start() < to_at);

        let merge_index = if let Some(Segment::Generated { from, .. }) = self.segments.get(index)
            && *from == from_at
        {
            Some(index)
        } else if let Some(Segment::Generated { from, to, .. }) = index
            .checked_sub(1)
            .and_then(|index| self.segments.get(index))
            && *from == from_at
            && to.end == to_at
        {
            Some(index - 1)
        } else {
            None
        };

        let shift_from = if let Some(merge_index) = merge_index {
            if let Some(Segment::Generated { to, .. }) = self.segments.get_mut(merge_index) {
                to.end += text.len();
            }
            merge_index + 1
        } else {
            self.segments.insert(
                index,
                Segment::Generated {
                    kind,
                    from: from_at,
                    to: to_at..to_at + text.len(),
                },
            );
            index + 1
        };

        let delta = text.len() as isize;
        for segment in &mut self.segments[shift_from..] {
            segment.shift_to(delta);
        }

        self.to_len += text.len();
    }

    /// Replaces a target range with generated text.
    pub fn replace(&mut self, range: Range<usize>, text: &str, kind: SegmentKind) {
        let start = range.start.max(self.prefix).min(self.to_len);
        let end = range.end.max(start).min(self.to_len);
        let from_at = self.backward(start);

        let mut rebuilt = Vec::with_capacity(self.segments.len() + 2);

        for segment in self.segments.drain(..) {
            let (to_start, to_end) = (segment.to_start(), segment.to_end());

            if to_end <= start || to_start >= end {
                rebuilt.push(segment);
                continue;
            }

            if to_start < start {
                rebuilt.push(segment.truncated_to(to_start..start));
            }
            if to_end > end {
                rebuilt.push(segment.truncated_to(end..to_end));
            }
        }

        let index = rebuilt.partition_point(|segment| segment.to_start() < start);

        let merge_index = if let Some(Segment::Generated { from, .. }) = rebuilt.get(index)
            && *from == from_at
        {
            Some(index)
        } else if let Some(Segment::Generated { from, to, .. }) =
            index.checked_sub(1).and_then(|index| rebuilt.get(index))
            && *from == from_at
            && to.end == start
        {
            Some(index - 1)
        } else {
            None
        };

        let shift_from = if let Some(merge_index) = merge_index {
            if let Some(Segment::Generated { to, .. }) = rebuilt.get_mut(merge_index) {
                to.end += text.len();
            }
            merge_index + 1
        } else {
            rebuilt.insert(
                index,
                Segment::Generated {
                    kind,
                    from: from_at,
                    to: start..start + text.len(),
                },
            );
            index + 1
        };

        let delta = text.len() as isize - (end - start) as isize;
        for segment in &mut rebuilt[shift_from..] {
            segment.shift_to(delta);
        }

        self.segments = rebuilt;
        self.to_len = self.to_len - (end - start) + text.len();
    }

    /// Invariant violations, empty when the map is sound.
    ///
    /// Used by tests and the debug lab. Cheap enough to call after every build
    /// and recovery edit under `debug_assertions`.
    #[must_use]
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let mut to_cursor = self.prefix;
        let mut from_cursor = 0;

        if self.prefix > self.to_len {
            problems.push(format!(
                "prefix {} exceeds to_len {}",
                self.prefix, self.to_len
            ));
        }

        for (index, segment) in self.segments.iter().enumerate() {
            if segment.to_start() != to_cursor {
                problems.push(format!(
                    "segment {index} ({}) starts at {} but the previous ends at {to_cursor}",
                    segment.kind().label(),
                    segment.to_start(),
                ));
            }

            match segment {
                Segment::Copy { from, .. } => {
                    if from.start < from_cursor {
                        problems.push(format!(
                            "segment {index} ({}) copy from {} overlaps the previous end {from_cursor}",
                            segment.kind().label(),
                            from.start,
                        ));
                    }
                    if from.end > self.from_len {
                        problems.push(format!(
                            "segment {index} ({}) copy ends at {} beyond from_len {}",
                            segment.kind().label(),
                            from.end,
                            self.from_len,
                        ));
                    }
                    from_cursor = from_cursor.max(from.end);
                }
                Segment::Generated { from, .. } => {
                    if *from > self.from_len {
                        problems.push(format!(
                            "segment {index} ({}) generated at {from} beyond from_len {}",
                            segment.kind().label(),
                            self.from_len,
                        ));
                    }
                    if *from < from_cursor {
                        problems.push(format!(
                            "segment {index} ({}) generated at {from} before the previous end {from_cursor}",
                            segment.kind().label(),
                        ));
                    }
                    from_cursor = from_cursor.max(*from);
                }
            }

            to_cursor = segment.to_end();
        }

        if to_cursor != self.to_len {
            problems.push(format!(
                "segments end at {to_cursor} but to_len is {}",
                self.to_len
            ));
        }

        if self.prefix > 0 && self.backward(self.prefix - 1) != 0 {
            problems.push(format!(
                "backward({}) inside the prefix returned {} instead of 0",
                self.prefix - 1,
                self.backward(self.prefix - 1),
            ));
        }

        // Both directions must stay in bounds at every segment boundary.
        for segment in &self.segments {
            for from in [segment.from_start(), segment.from_end()] {
                if self.forward(from, Side::Before) > self.to_len
                    || self.forward(from, Side::After) > self.to_len
                {
                    problems.push(format!("forward({from}) escaped to_len {}", self.to_len));
                }
            }
            for to in [segment.to_start(), segment.to_end()] {
                if self.backward(to) > self.from_len {
                    problems.push(format!("backward({to}) escaped from_len {}", self.from_len));
                }
            }
        }

        problems
    }
}

/// Builds a target text and its map together, so the two cannot drift.
pub struct SourceBuilder<'a> {
    raw: &'a str,
    text: String,
    prefix: usize,
    segments: Vec<Segment>,
}

impl<'a> SourceBuilder<'a> {
    #[must_use]
    pub fn new(raw: &'a str) -> Self {
        Self {
            raw,
            text: String::new(),
            prefix: 0,
            segments: Vec::new(),
        }
    }

    /// Appends generated text that sits before the first source byte, such as
    /// the document prelude.
    ///
    /// Source position 0 maps to the end of this text under [`Side::Before`],
    /// so callers cannot select the prefix by accident. Must be called before
    /// any copy or generated append.
    pub fn prefix(&mut self, text: &str) {
        debug_assert!(
            self.text.is_empty() && self.prefix == 0 && self.segments.is_empty(),
            "the prefix must be appended before any other text"
        );

        self.text.push_str(text);
        self.prefix = self.text.len();
    }

    /// Appends a range of the source text and records the copy.
    pub fn copy(&mut self, range: Range<usize>) {
        if range.is_empty() {
            return;
        }

        let start = self.text.len();
        self.text.push_str(&self.raw[range.clone()]);
        self.segments.push(Segment::Copy {
            kind: SegmentKind::Source,
            from: range,
            to: start..self.text.len(),
        });
    }

    /// Appends generated text that sits at source position `at`.
    ///
    /// Adjacent generated text at the same position merges into one span.
    pub fn generated(&mut self, at: usize, text: &str, kind: SegmentKind) {
        if text.is_empty() {
            return;
        }

        let start = self.text.len();
        self.text.push_str(text);

        if let Some(Segment::Generated { from, to, .. }) = self.segments.last_mut()
            && *from == at
        {
            to.end = self.text.len();
            return;
        }

        self.segments.push(Segment::Generated {
            kind,
            from: at,
            to: start..self.text.len(),
        });
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.text.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The finished text and map. The map is validated in debug builds.
    #[must_use]
    pub fn finish(self) -> (String, SourceMap) {
        let map = SourceMap {
            prefix: self.prefix,
            segments: self.segments,
            from_len: self.raw.len(),
            to_len: self.text.len(),
        };

        #[cfg(debug_assertions)]
        {
            let problems = map.validate();
            debug_assert!(
                problems.is_empty(),
                "builder produced an invalid map: {problems:?}"
            );
        }

        (self.text, map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_of(raw: &str, ops: &[(usize, &str)]) -> SourceMap {
        let mut builder = SourceBuilder::new(raw);
        let mut cursor = 0;

        for (at, text) in ops {
            builder.copy(cursor..*at);
            builder.generated(*at, text, SegmentKind::Unknown);
            cursor = *at;
        }

        builder.copy(cursor..raw.len());
        builder.finish().1
    }

    #[test]
    fn identity_map_round_trips() {
        let map = SourceMap::identity(10);

        for offset in 0..=10 {
            assert_eq!(map.forward(offset, Side::Before), offset);
            assert_eq!(map.forward(offset, Side::After), offset);
            assert_eq!(map.backward(offset), offset);
        }
        assert!(map.validate().is_empty());
    }

    #[test]
    fn insertions_shift_both_sides() {
        let map = map_of("abcdef", &[(3, "XY")]);

        // Before the insertion.
        assert_eq!(map.forward(0, Side::After), 0);
        assert_eq!(map.forward(3, Side::Before), 3);
        assert_eq!(map.forward(3, Side::After), 5);
        assert_eq!(map.forward(4, Side::After), 6);
        assert_eq!(map.backward(0), 0);
        assert_eq!(map.backward(3), 3);
        assert_eq!(map.backward(4), 3);
        assert_eq!(map.backward(5), 3);
        assert_eq!(map.backward(6), 4);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn duplicate_insertions_merge() {
        let map = map_of("ab", &[(1, "X"), (1, "Y")]);

        assert_eq!(map.forward(1, Side::Before), 1);
        assert_eq!(map.forward(1, Side::After), 3);
        assert_eq!(map.backward(2), 1);
        assert_eq!(map.backward(3), 1);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn dropped_leading_text_clamps() {
        // "\n" never makes it into the target: the map starts with generated
        // text at 0, then copies from 1.
        let mut builder = SourceBuilder::new("\nhello");
        builder.generated(0, "PRE", SegmentKind::Prelude);
        builder.copy(1..6);
        let map = builder.finish().1;

        assert_eq!(map.forward(0, Side::Before), 0);
        assert_eq!(map.forward(0, Side::After), 3);
        assert_eq!(map.forward(1, Side::After), 3);
        assert_eq!(map.backward(0), 0);
        assert_eq!(map.backward(2), 0);
        // At the boundary the following copy owns the position.
        assert_eq!(map.backward(3), 1);
        assert_eq!(map.backward(4), 2);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn insert_splits_a_copy() {
        let mut map = SourceMap::identity(6);
        map.insert(3, "XY", SegmentKind::ErrorMark);

        assert_eq!(map.to_len(), 8);
        assert_eq!(map.forward(3, Side::Before), 3);
        assert_eq!(map.forward(3, Side::After), 5);
        assert_eq!(map.backward(3), 3);
        assert_eq!(map.backward(4), 3);
        assert_eq!(map.backward(5), 3);
        assert_eq!(map.backward(6), 4);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn insert_merges_with_neighbour() {
        let mut map = SourceMap::identity(4);
        map.insert(2, "X", SegmentKind::ErrorMark);
        map.insert(3, "Y", SegmentKind::ErrorMark);

        assert_eq!(map.to_len(), 6);
        assert_eq!(map.forward(2, Side::Before), 2);
        assert_eq!(map.forward(2, Side::After), 4);
        assert_eq!(map.backward(3), 2);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn replace_keeps_lengths_and_offsets() {
        let mut map = SourceMap::identity(6);
        map.replace(2..4, "xy", SegmentKind::ErrorMark);

        assert_eq!(map.to_len(), 6);
        // After generated text at 2, the next copy starts at 4.
        assert_eq!(map.forward(2, Side::After), 4);
        assert_eq!(map.backward(2), 2);
        assert_eq!(map.backward(3), 2);
        assert_eq!(map.backward(4), 4);
        assert_eq!(map.backward(5), 5);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn replace_can_shrink_and_grow() {
        let mut map = SourceMap::identity(6);
        map.replace(1..5, "abc", SegmentKind::ErrorMark);

        assert_eq!(map.to_len(), 5);
        assert_eq!(map.forward(0, Side::After), 0);
        assert_eq!(map.forward(1, Side::After), 4);
        assert_eq!(map.forward(5, Side::After), 4);
        assert_eq!(map.backward(3), 1);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn prefix_is_not_selectable_by_accident() {
        let mut builder = SourceBuilder::new("hello");
        builder.prefix("PRELUDE");
        builder.generated(0, "[", SegmentKind::Wrapper);
        builder.copy(0..5);
        builder.generated(5, "]", SegmentKind::Wrapper);
        let map = builder.finish().1;

        // Before the wrapper, after the prefix.
        assert_eq!(map.forward(0, Side::Before), 7);
        // After the wrapper, at the start of the copy.
        assert_eq!(map.forward(0, Side::After), 8);
        assert_eq!(map.backward(7), 0);
        assert_eq!(map.backward(8), 0);
        assert_eq!(map.backward(3), 0);
        assert_eq!(map.prefix_len(), 7);
        assert!(map.validate().is_empty());
    }

    #[test]
    fn empty_map_is_total() {
        let map = SourceMap::default();

        assert_eq!(map.forward(0, Side::Before), 0);
        assert_eq!(map.forward(usize::MAX, Side::After), 0);
        assert_eq!(map.backward(0), 0);
        assert_eq!(map.backward(usize::MAX), 0);
        assert!(map.validate().is_empty());
    }
}
