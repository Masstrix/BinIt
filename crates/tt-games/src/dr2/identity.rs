//! Stable identities for the stages and cars DiRT Rally 2.0 doesn't name.
//!
//! The telemetry gives numbers, not names, so a stage or car is known by an id worked out from those
//! numbers. The same stage or car gives the same id on every machine, which is what lets a name recorded
//! once (see `known.rs`) apply to everyone's stored runs.
//!
//! * A **stage** is its length (identical for everyone) and where its start line is. The start position
//!   moves a little between starts (about 0.1 m, with the size of the car), so it is snapped to a
//!   [`GRID_M`] grid; a start that sits within [`EDGE_M`] of a cell edge could land in either cell, so
//!   [`stage_ids_near`] lists the neighbouring cell's id too and a recorded name matches both. A reverse
//!   stage starts where the forward one finishes, so it gets a different id.
//! * A **car** is its engine: rev limit, idle speed and gear count, which tuning can't change. Gear ratios
//!   can be tuned, so they are never part of it.
//!
//! The hash is FNV-1a over a fixed text, folded to six hex digits: it must never change between versions,
//! because ids are stored in people's data (the tests pin some).

/// The start position is snapped to a grid this many metres across.
pub const GRID_M: f32 = 50.0;
/// A start this close (metres) to a cell's edge also matches the cell on the other side.
pub const EDGE_M: f32 = 1.0;

fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Six upper-case hex digits (24 bits): enough that a few hundred stages and cars won't collide.
fn short(hash: u64) -> String {
    format!("{:06X}", (hash ^ (hash >> 24) ^ (hash >> 48)) & 0xFF_FFFF)
}

fn cell_of(position: f32) -> i32 {
    (position / GRID_M).floor() as i32
}

fn stage_cell_id(length_m: f32, cell: (i32, i32)) -> String {
    short(fnv1a(&format!("dr2-stage|{}|{}|{}", length_m.round() as i64, cell.0, cell.1)))
}

/// The id of a stage: its length and the grid cell its start line is in.
pub fn stage_id(length_m: f32, start: [f32; 2]) -> String {
    stage_cell_id(length_m, (cell_of(start[0]), cell_of(start[1])))
}

/// The ids a start could be taken for: its own cell's, and the neighbouring cell's on each side it is within
/// [`EDGE_M`] of (including the diagonal when it is near a corner). The first is the stage's own id.
pub fn stage_ids_near(length_m: f32, start: [f32; 2]) -> Vec<String> {
    // For each axis: its cell, and the next one over if the position is close to that edge.
    let axis = |v: f32| {
        let cell = cell_of(v);
        let into_cell = v - cell as f32 * GRID_M;
        let mut cells = vec![cell];
        if into_cell < EDGE_M {
            cells.push(cell - 1);
        } else if GRID_M - into_cell < EDGE_M {
            cells.push(cell + 1);
        }
        cells
    };
    let mut ids = Vec::new();
    for &x in &axis(start[0]) {
        for &z in &axis(start[1]) {
            let id = stage_cell_id(length_m, (x, z));
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

/// The id of a car: its rev limit and idle speed (rpm, to the nearest) and its gear count.
pub fn car_id(max_rpm: f32, idle_rpm: f32, gears: u8) -> String {
    short(fnv1a(&format!("dr2-car|{}|{}|{}", max_rpm.round() as i64, idle_rpm.round() as i64, gears)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Read from the game: the 2.85 km stage (starts at x 903.70, z 205.6) and three cars.
    const LENGTH: f32 = 2845.63;

    #[test]
    fn the_ids_never_change() {
        // Pinned: ids are stored in people's data, so a change here would orphan it.
        assert_eq!(stage_id(LENGTH, [903.70, 205.61]), "8B2484");
        assert_eq!(stage_id(9666.5, [2871.86, -2032.91]), "73ABB4");
        assert_eq!(car_id(7749.26, 1780.24, 5), "AB77AD");
        assert_eq!(car_id(8377.58, 2199.11, 5), "ABC5D6");
        assert_eq!(car_id(7330.4, 1466.1, 5), "5161C9");
    }

    #[test]
    fn a_stage_start_that_moves_a_little_is_the_same_stage() {
        // Seven recorded starts: x 903.70, z between 205.56 and 205.67 (the car's size shifts it).
        for z in [205.56, 205.61, 205.62, 205.67] {
            assert_eq!(stage_id(LENGTH, [903.70, z]), "8B2484", "z {z}");
        }
        assert_eq!(stage_id(LENGTH, [903.2, 206.4]), "8B2484", "and a few tenths of a metre more");
    }

    #[test]
    fn the_reverse_of_a_stage_is_a_different_stage_with_the_same_length() {
        // The 9.67 km stage runs (2872, -2033) to (1169, 455): reversed it would start at the finish.
        assert_ne!(stage_id(9666.5, [2871.86, -2032.91]), stage_id(9666.5, [1168.7, 454.8]));
        // And two stages of the same length in different places differ too.
        assert_ne!(stage_id(LENGTH, [903.70, 205.6]), stage_id(LENGTH, [1500.0, -300.0]));
    }

    #[test]
    fn a_start_beside_a_cell_edge_matches_the_cell_on_the_other_side_too() {
        // x = 900.3 is 0.3 m into its cell: a start 0.5 m the other way is in the cell before it.
        let near = stage_ids_near(LENGTH, [900.3, 225.0]);
        assert_eq!(near.len(), 2);
        assert_eq!(near[0], stage_id(LENGTH, [900.3, 225.0]));
        assert!(near.contains(&stage_id(LENGTH, [899.8, 225.0])), "the neighbour cell is accepted");
        // Near a corner it is four.
        assert_eq!(stage_ids_near(LENGTH, [900.3, 200.4]).len(), 4);
        // Away from an edge it is just the one.
        assert_eq!(stage_ids_near(LENGTH, [925.0, 225.0]).len(), 1);
    }

    #[test]
    fn a_car_is_its_engine_and_nothing_tuning_can_change() {
        assert_ne!(car_id(7749.26, 1780.24, 5), car_id(8377.58, 2199.11, 5), "the two R5s differ");
        // The same car with a hair of float noise.
        assert_eq!(car_id(7749.26, 1780.24, 5), car_id(7749.3, 1780.2, 5));
        assert_ne!(car_id(7749.26, 1780.24, 5), car_id(7749.26, 1780.24, 6));
    }
}
