//! A raw look at what a game's shared memory holds, for the dev-only Memory page.
//!
//! Each page is copied whole (every byte the OS mapped) and sent with the names and types of the fields
//! Bin It knows about, so the UI can show the known fields decoded and every other word as plain numbers.
//! This opens its own read-only handles; it never touches the adapters.

use serde_json::{Value, json};

use crate::{acpmf, acevo};
use crate::acevo::layout::{Electronics, Graphics, Static, TyreState};
use crate::shm::SharedMemory;

/// A field Bin It knows: where it sits, how big it is and what its elements are.
struct Field {
    name: String,
    offset: usize,
    size: usize,
    /// `i32`, `f32`, `u8`, ... or `text` (ASCII) / `utf16` (UTF-16 text).
    kind: &'static str,
}

fn field(name: &str, offset: usize, size: usize, kind: &'static str) -> Field {
    Field { name: name.to_string(), offset, size, kind }
}

/// Lists fields of a `repr(C)` struct by name, taking offsets and sizes from the struct itself.
/// `a.b` reaches into a nested struct.
macro_rules! fields {
    ($ty:ty; $($f:ident $(. $g:ident)* : $kind:ident),* $(,)?) => {{
        let z: $ty = unsafe { std::mem::zeroed() };
        vec![$(
            field(
                &stringify!($f $(. $g)*).replace(' ', ""),
                std::mem::offset_of!($ty, $f $(. $g)*),
                std::mem::size_of_val(&{ z.$f $(. $g)* }),
                stringify!($kind),
            )
        ),*]
    }};
}

/// The four electronics blocks, named block by block: current, then each setting's min, max and step.
fn evo_electronics_fields() -> Vec<Field> {
    let base = std::mem::offset_of!(Graphics, electronics);
    let block = fields!(Electronics;
        tc_level: i8, tc_cut_level: i8, abs_level: i8, esc_level: i8, ebb_level: i8, brake_bias: f32,
        engine_map_level: i8, turbo_level: f32, ers_deployment_map: i8, ers_recharge_map: f32,
        is_ers_heat_charging_on: u8, is_ers_overtake_mode_on: u8, is_drs_open: u8, diff_power_level: i8,
        diff_coast_level: i8, front_bump_damper_level: i8, front_rebound_damper_level: i8,
        rear_bump_damper_level: i8, rear_rebound_damper_level: i8, is_ignition_on: u8, is_pitlimiter_on: u8,
        active_performance_mode: i8,
    );
    let mut out = Vec::new();
    for (i, which) in ["now", "min", "max", "step"].iter().enumerate() {
        for f in &block {
            out.push(field(&format!("electronics.{which}.{}", f.name), base + i * size_of::<Electronics>() + f.offset, f.size, f.kind));
        }
    }
    out
}

/// The four tyres (left front, right front, left rear, right rear), by name.
fn evo_tyre_fields() -> Vec<Field> {
    let base = std::mem::offset_of!(Graphics, tyres);
    let tyre = fields!(TyreState;
        unknown_0: f32, unknown_4: f32, pressure_psi: f32, core_temp_c: f32, brake_temp_c: f32, unknown_20: f32,
        tread_temp_c: f32, compound: text, compound_alt: text, unknown_104: f32, wear_like: f32,
    );
    let mut out = Vec::new();
    for (i, which) in ["lf", "rf", "lr", "rr"].iter().enumerate() {
        for f in &tyre {
            out.push(field(&format!("tyre.{which}.{}", f.name), base + i * size_of::<TyreState>() + f.offset, f.size, f.kind));
        }
    }
    out
}

fn evo_graphics_fields() -> Vec<Field> {
    let mut all = evo_graphics_plain_fields();
    all.extend(evo_electronics_fields());
    all.extend(evo_tyre_fields());
    all
}

fn evo_graphics_plain_fields() -> Vec<Field> {
    fields!(Graphics;
        packet_id: i32, status: i32, focused_car_id: u64, player_car_id: u64, rpm: u16, engine_flags: u8,
        display_speed_kmh: i16, display_speed_mph: i16, display_speed_ms: i16, pitspeeding_delta: f32,
        gear_int: i16, inputs: f32, water_temperature_c: i8, air_temperature_c: i8, engine: f32,
        steer_degrees: i32, current_km: f32, total_km: u32, total_driving_time_s: u32, time_of_day: i32,
        delta_time_ms: i32, current_lap_time_ms: i32, predicted_lap_time_ms: i32, fuel: f32,
        current_torque: f32, current_bhp: i32, npos: f32, kers_charge_perc: f32,
        kers_current_perc: f32, control_lock_time: f32, car_damage: u32, car_location: i32, pit_info: u32,
        fuel_and_battery: f32, instrumentation: u32, total_lap_count: i32, current_pos: u32,
        total_drivers: u32, last_laptime_ms: i32, best_laptime_ms: i32, flag: i32, global_flag: i32,
        max_gears: u32, engine_type: i32, has_kers: u8, is_last_lap: u8, performance_mode_name: text,
        diff_coast_raw_value: f32, diff_power_raw_value: f32, race_cut_gained_time_ms: i32,
        distance_to_deadline: i32, race_cut_current_delta: f32,
        session_state.phase_name: text, session_state.time_left: text, session_state.time_left_ms: i32,
        session_state.wait_time: text, session_state.total_lap: i32, session_state.current_lap: i32,
        session_state.lights_on: i32, session_state.lights_mode: i32, session_state.lap_length_km: f32,
        session_state.end_session_flag: i32, session_state.time_to_next_session: text,
        session_state.disconnected_from_server: u8, session_state.restart_season_enabled: u8,
        session_state.ui_enable_drive: u8, session_state.ui_enable_setup: u8,
        session_state.is_ready_to_next_blinking: u8, session_state.show_waiting_for_players: u8,
        timing_state.current_laptime: text, timing_state.delta_current: text, timing_state.delta_current_p: i32,
        timing_state.last_laptime: text, timing_state.delta_last: text, timing_state.delta_last_p: i32,
        timing_state.best_laptime: text, timing_state.ideal_laptime: text, timing_state.total_time: text,
        timing_state.is_invalid: u8,
        player_stats: i32, driver_name: text, driver_surname: text, car_model: text, is_in_pit_box: u8,
        is_in_pit_lane: u8, is_valid_lap: u8, car_coordinates: f32, gap_ahead: f32, gap_behind: f32,
        active_cars: u8, fuel_per_lap: f32, fuel_estimated_laps: f32, assists_state: u32, max_fuel: f32,
        max_turbo_boost: f32, use_single_compound: u8, car_ids: u64,
    )
}

fn evo_static_fields() -> Vec<Field> {
    fields!(Static;
        sm_version: text, ac_evo_version: text, session: i32, session_name: text, event_id: u8, session_id: u8,
        starting_grip: i32, starting_ambient_temperature_c: f32, starting_ground_temperature_c: f32,
        is_static_weather: u8, is_timed_race: u8, is_online: u8, number_of_sessions: i32, nation: text,
        longitude: f32, latitude: f32, track: text, track_configuration: text, track_length_m: f32,
    )
}

fn physics_fields() -> Vec<Field> {
    use acpmf::physics as p;
    vec![
        field("packet_id", p::PACKET_ID, 4, "i32"),
        field("gas", p::GAS, 4, "f32"),
        field("brake", p::BRAKE, 4, "f32"),
        field("gear", p::GEAR, 4, "i32"),
        field("rpm", p::RPM, 4, "i32"),
        field("steer_angle", p::STEER_ANGLE, 4, "f32"),
        field("speed_kmh", p::SPEED_KMH, 4, "f32"),
        field("tyres_out", p::TYRES_OUT, 4, "i32"),
        field("clutch", p::CLUTCH, 4, "f32"),
    ]
}

fn ac_graphics_fields() -> Vec<Field> {
    use crate::ac::layout::graphics as g;
    vec![
        field("packet_id", g::PACKET_ID, 4, "i32"),
        field("status", g::STATUS, 4, "i32"),
        field("session", g::SESSION, 4, "i32"),
        field("completed_laps", g::COMPLETED_LAPS, 4, "i32"),
        field("current_time_ms", g::CURRENT_TIME_MS, 4, "i32"),
        field("last_time_ms", g::LAST_TIME_MS, 4, "i32"),
        field("best_time_ms", g::BEST_TIME_MS, 4, "i32"),
        field("is_in_pit", g::IS_IN_PIT, 4, "i32"),
        field("current_sector", g::CURRENT_SECTOR, 4, "i32"),
        field("normalized_position", g::NORMALIZED_POSITION, 4, "f32"),
        field("car_coordinates", g::CAR_COORDINATES, 12, "f32"),
        field("is_in_pit_lane", g::IS_IN_PIT_LANE, 4, "i32"),
    ]
}

fn ac_static_fields() -> Vec<Field> {
    use crate::ac::layout::statics as s;
    vec![
        field("sm_version", s::SM_VERSION, 30, "utf16"),
        field("ac_version", s::AC_VERSION, 30, "utf16"),
        field("car_model", s::CAR_MODEL, 66, "utf16"),
        field("track", s::TRACK, 66, "utf16"),
        field("sector_count", s::SECTOR_COUNT, 4, "i32"),
        field("track_spline_length", s::TRACK_SPLINE_LENGTH, 4, "f32"),
        field("track_configuration", s::TRACK_CONFIGURATION, 30, "utf16"),
    ]
}

fn acr_graphics_fields() -> Vec<Field> {
    use crate::acr::layout::graphics as g;
    vec![
        field("packet_id", g::PACKET_ID, 4, "i32"),
        field("clock_text", g::CLOCK_TEXT, 30, "utf16"),
        field("last_time_text", g::LAST_TIME_TEXT, 30, "utf16"),
        field("best_time_text", g::BEST_TIME_TEXT, 30, "utf16"),
        field("distance_traveled", g::DISTANCE_TRAVELED, 4, "f32"),
        field("active_cars", g::ACTIVE_CARS, 4, "i32"),
        field("car_coordinates", g::CAR_COORDINATES, g::MAX_CARS * 12, "f32"),
        field("car_ids", g::CAR_IDS, g::MAX_CARS * 4, "i32"),
        field("player_car_id", g::PLAYER_CAR_ID, 4, "i32"),
    ]
}

fn acr_static_fields() -> Vec<Field> {
    use crate::acr::layout::statics as s;
    vec![
        field("car_model", s::CAR_MODEL, 66, "utf16"),
        field("stage", s::STAGE, 66, "utf16"),
        field("player_name", s::PLAYER_NAME, 66, "utf16"),
        field("stage_length", s::STAGE_LENGTH, 4, "f32"),
    ]
}

/// One page as JSON: its name, size, whole contents (hex) and known fields. A page that isn't there
/// (the game isn't running, or doesn't publish it) comes back with `bytes: null`.
fn page(label: &str, shm_name: &str, known: Vec<Field>) -> Value {
    let (open, size, bytes) = match SharedMemory::open(shm_name) {
        Ok(shm) => {
            let size = shm.region_size();
            (true, size, shm.bytes(size))
        }
        Err(_) => (false, 0, Vec::new()),
    };
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let fields: Vec<Value> = known
        .into_iter()
        .map(|f| json!({ "name": f.name, "offset": f.offset, "size": f.size, "kind": f.kind }))
        .collect();
    json!({ "label": label, "name": shm_name, "open": open, "size": size, "hex": hex, "fields": fields })
}

/// The pages `game` publishes, read now. `None` for a game without shared memory.
pub fn read_pages(game: &str) -> Option<Vec<Value>> {
    Some(match game {
        "acevo" => vec![
            // Nothing named yet: the point is to find heading, velocity and slip in it.
            page("physics", "Local\acevo_pmf_physics", Vec::new()),
            page("graphics", acevo::GRAPHICS_PAGE, evo_graphics_fields()),
            page("static", acevo::STATIC_PAGE, evo_static_fields()),
        ],
        "ac" => vec![
            page("physics", acpmf::PHYSICS_PAGE, physics_fields()),
            page("graphics", acpmf::GRAPHICS_PAGE, ac_graphics_fields()),
            page("static", acpmf::STATIC_PAGE, ac_static_fields()),
        ],
        "acr" => vec![
            page("physics", acpmf::PHYSICS_PAGE, physics_fields()),
            page("graphics", acpmf::GRAPHICS_PAGE, acr_graphics_fields()),
            page("static", acpmf::STATIC_PAGE, acr_static_fields()),
        ],
        _ => return None,
    })
}
