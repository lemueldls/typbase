//! Frame item bounding: turns a compiled page's frame items into positioned
//! blocks with source ranges.
//!
//! Kept separate from the partitioning loop in `items.rs` so the range rules
//! live next to the tag stack that produces them.

use std::{cmp, iter, ops::Range};

use typst::{
    WorldExt,
    introspection::Tag,
    layout::{FrameItem, Point, Rect},
    syntax::Span,
};

use crate::{renderer::paged::BoundFrameItem, source::SourceContext, world::TypstWorld};

/// Recursively bounds a frame item, producing frame blocks with position and
/// range.
// #[comemo::memoize]
#[typst_macros::time]
pub(super) fn bound_frame(
    frame_item: &(Point, FrameItem),
    parent_point: Option<Point>,
    sink: &mut BoundFrameSink,
    context: &SourceContext,
    world: &TypstWorld,
) -> Box<[BoundFrameItem]> {
    let (point, item) = frame_item;

    let bounds = match &item {
        FrameItem::Text(text) => {
            let bbox = text.bbox();

            Rect::new(
                // text runs use a y-up coordinate system
                Point::new(point.x + bbox.min.x, point.y + bbox.max.y),
                Point::new(point.x + bbox.max.x, point.y + bbox.min.y),
            )
        }
        FrameItem::Group(group) => {
            if group.transform.is_identity() {
                let point = if let Some(parent_point) = parent_point {
                    parent_point + *point
                } else {
                    *point
                };

                return group
                    .frame
                    .items()
                    .flat_map(|frame_item| {
                        bound_frame(frame_item, Some(point), sink, context, world)
                    })
                    .collect::<Box<[_]>>();
            }

            let (range, bounds) = group
                .frame
                .items()
                .flat_map(|frame_item| bound_frame(frame_item, None, sink, context, world))
                .fold(
                    (
                        None::<Range<usize>>,
                        Rect::new(Point::zero(), Point::zero()),
                    ),
                    |(range, mut bounds), frame_block| {
                        let range = match (range, frame_block.range) {
                            (Some(range), Some(block_range)) => {
                                let start = cmp::min(range.start, block_range.start);
                                let end = cmp::max(range.end, block_range.end);

                                Some(start..end)
                            }
                            (Some(range), None) => Some(range),
                            (None, Some(block_range)) => Some(block_range),
                            (None, None) => None,
                        };

                        bounds.min.x = cmp::min(bounds.min.x, frame_block.bounds.min.x);
                        bounds.min.y = cmp::min(bounds.min.y, frame_block.bounds.min.y);
                        bounds.max.x = cmp::max(bounds.max.x, frame_block.bounds.max.x);
                        bounds.max.y = cmp::max(bounds.max.y, frame_block.bounds.max.y);

                        // sink.process_tooltips(frame_block);

                        (range, bounds)
                    },
                );

            let mut item = BoundFrameItem {
                range,
                bounds,
                item: item.clone(),
                point: *point,
            };

            if let Some(point) = parent_point {
                item.point.x += point.x;
                item.point.y += point.y;
                item.bounds.min.x += point.x;
                item.bounds.min.y += point.y;
                item.bounds.max.x += point.x;
                item.bounds.max.y += point.y;
            }

            sink.process_tooltips(&item);

            return iter::once(item).collect::<Box<[_]>>();
        }
        FrameItem::Shape(shape, _span) => {
            let bbox = shape.bbox(true);

            Rect::new(
                Point::new(point.x + bbox.min.x, point.y + bbox.min.y),
                Point::new(point.x + bbox.max.x, point.y + bbox.max.y),
            )
        }
        FrameItem::Image(_image, axes, _span) => Rect::new(*point, Point::new(axes.x, axes.y)),
        FrameItem::Link(..) => Rect::new(*point, *point),
        FrameItem::Tag(..) => Rect::new(*point, *point),
    };

    let range = frame_item_range(item, sink, context, world);

    let mut item = BoundFrameItem {
        range,
        bounds,
        item: item.clone(),
        point: *point,
    };

    if let Some(point) = parent_point {
        item.point.x += point.x;
        item.point.y += point.y;
        item.bounds.min.x += point.x;
        item.bounds.min.y += point.y;
        item.bounds.max.x += point.x;
        item.bounds.max.y += point.y;
    }

    sink.process_tooltips(&item);

    iter::once(item).collect::<Box<[_]>>()
}

/// Collects tooltip items while walking a frame's tag stack.
#[derive(Default)]
pub(super) struct BoundFrameSink {
    pub(super) tooltips: Vec<Vec<BoundFrameItem>>,
    tag_stack: Vec<(&'static str, Span)>,
}

// #[comemo::track]
impl BoundFrameSink {
    pub fn process_tooltips(&mut self, item: &BoundFrameItem) {
        if let Some((name, _span)) = self.tag_stack.last()
            && *name == "equation"
        {
            self.tooltips.last_mut().unwrap().push(item.clone());
        }
    }

    pub fn push_tag(&mut self, name: &'static str, span: Span) {
        self.tooltips.push(Vec::new());
        self.tag_stack.push((name, span));
    }

    pub fn pop_tag(&mut self) -> Option<(&'static str, Span)> {
        self.tag_stack.pop()
    }
}

/// Determines the source range for a frame item, using tag stack for
/// introspectable tags.
#[typst_macros::time]
fn frame_item_range(
    item: &FrameItem,
    sink: &mut BoundFrameSink,
    context: &SourceContext,
    world: &TypstWorld,
) -> Option<Range<usize>> {
    let span = match item {
        FrameItem::Group(..) => unreachable!(),
        FrameItem::Text(text) => {
            let first_glyph_span = text.glyphs.first()?.span.0;
            let first_glyph_range = world.range(first_glyph_span)?;

            let last_glyph_span = text.glyphs.last()?.span.0;
            let last_glyph_range = world.range(last_glyph_span)?;

            return Some(first_glyph_range.start..last_glyph_range.end);
        }
        FrameItem::Shape(_shape, span) => *span,
        FrameItem::Image(_image, _axes, span) => *span,
        FrameItem::Link(_destination, _axes) => return None,
        FrameItem::Tag(tag) => {
            match tag {
                Tag::Start(c, flags) => {
                    let name = c.elem().name();
                    let span = c.span();

                    if flags.introspectable {
                        sink.push_tag(name, span);
                    }

                    // crate::log!("[START FLAGS]: {flags:?} {name}");

                    return None;
                }
                Tag::End(_location, _key, flags) => {
                    if flags.introspectable
                        && let Some((name, span)) = sink.pop_tag()
                    {
                        match name {
                            "equation" => span,
                            _ => return None,
                        }
                        // span
                    } else {
                        return None;
                    }

                    // crate::log!("[END FLAG]: {flags:?}");
                }
            }
        }
    };

    // Frame items can come from either compile source: the render source
    // during a recovered render, the pristine synth when nothing failed.
    if span.id().is_some_and(|id| context.owns_span(id)) {
        world.range(span)
    } else {
        None
    }
}
