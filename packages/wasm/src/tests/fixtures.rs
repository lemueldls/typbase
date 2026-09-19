//! Source fixtures for the engine suites, loaded from `fixtures/`.
//!
//! Fixtures are plain `.typ` files so they can be opened in the editor or the
//! debug lab without copying strings out of Rust. The directory a fixture sits
//! in is its contract:
//!
//! - `clean/` must render with no diagnostics. The partition and tooltip
//!   snapshots walk it.
//! - `broken/` must render through recovery. An optional `.expect` sidecar
//!   lists diagnostic substrings the fixture has to produce, one per line.
//! - `adversarial/` only has to keep the source maps sound. It never renders,
//!   so parser errors, odd line endings, and exotic Unicode are all fair game.
//!
//! Keep sources small: snapshots of frame geometry grow fast, and a fixture
//! that fits in one paragraph is enough to exercise a partition decision.

use std::path::{Path, PathBuf};

/// One named raw source.
pub struct Fixture {
    pub name: String,
    pub source: String,
    /// Required diagnostic substrings, from `<name>.expect`.
    pub expect: Vec<String>,
}

fn fixtures_dir(group: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures")
        .join(group)
}

fn load(group: &str) -> Vec<Fixture> {
    let dir = fixtures_dir(group);
    let entries = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()));

    let mut fixtures = Vec::new();

    for entry in entries {
        let path = entry.expect("cannot read fixture entry").path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("typ") {
            continue;
        }

        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .expect("fixture name is not utf-8")
            .to_string();
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));

        let expect_path = path.with_extension("expect");
        let expect = if expect_path.is_file() {
            std::fs::read_to_string(&expect_path)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", expect_path.display()))
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(str::to_string)
                .collect()
        } else {
            Vec::new()
        };

        fixtures.push(Fixture {
            name,
            source,
            expect,
        });
    }

    fixtures.sort_by(|left, right| left.name.cmp(&right.name));
    fixtures
}

/// The clean fixtures, in name order.
pub fn clean() -> Vec<Fixture> {
    load("clean")
}

/// The recovery fixtures, in name order.
pub fn broken() -> Vec<Fixture> {
    load("broken")
}

/// The map-only fixtures, in name order.
pub fn adversarial() -> Vec<Fixture> {
    load("adversarial")
}

/// One fixture by directory and name, for tests that need a specific source.
pub fn get(group: &str, name: &str) -> Fixture {
    let mut fixtures = load(group);
    let index = fixtures
        .iter()
        .position(|fixture| fixture.name == name)
        .unwrap_or_else(|| panic!("no fixture {group}/{name}.typ"));
    fixtures.swap_remove(index)
}
