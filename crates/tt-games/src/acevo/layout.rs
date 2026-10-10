//! Memory layout of AC EVO's shared-memory pages.
//!
//! Transcribed from Kunos' shared-memory header (`#pragma pack(4)`), as mirrored by
//! <https://github.com/dSyncro/acevo-shared-memory> (MIT). `repr(C, packed(4))` gives
//! the same field offsets as MSVC's `pack(4)`.
//!
//! Sub-structures we don't read are kept as opaque `[u32; N]` blocks of the documented
//! size. Every one of them follows a 4-byte field, so their alignment doesn't change
//! any offsets.
//!
//! The game is in early access and Kunos has changed this layout before (2026-03-31),
//! so the adapter checks `sm_version` and sanity-checks values before trusting them.

#![allow(dead_code)]

pub const STATUS_OFF: i32 = 0;
pub const STATUS_REPLAY: i32 = 1;
pub const STATUS_LIVE: i32 = 2;
pub const STATUS_PAUSE: i32 = 3;

pub const SESSION_UNKNOWN: i32 = -1;
pub const SESSION_TIME_ATTACK: i32 = 0;
pub const SESSION_RACE: i32 = 1;
pub const SESSION_HOT_STINT: i32 = 2;
pub const SESSION_CRUISE: i32 = 3;

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct SessionState {
    pub phase_name: [u8; 33],
    pub time_left: [u8; 15],
    pub time_left_ms: i32,
    pub wait_time: [u8; 15],
    pub total_lap: i32,
    pub current_lap: i32,
    pub lights_on: i32,
    pub lights_mode: i32,
    pub lap_length_km: f32,
    pub end_session_flag: i32,
    pub time_to_next_session: [u8; 15],
    pub disconnected_from_server: u8,
    pub restart_season_enabled: u8,
    pub ui_enable_drive: u8,
    pub ui_enable_setup: u8,
    pub is_ready_to_next_blinking: u8,
    pub show_waiting_for_players: u8,
    pub place_holder: [u8; 140],
}

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct TimingState {
    pub current_laptime: [u8; 15],
    pub delta_current: [u8; 15],
    pub delta_current_p: i32,
    pub last_laptime: [u8; 15],
    pub delta_last: [u8; 15],
    pub delta_last_p: i32,
    pub best_laptime: [u8; 15],
    pub ideal_laptime: [u8; 15],
    pub total_time: [u8; 15],
    pub is_invalid: u8,
    pub place_holder: [u8; 137],
}

/// `SPageFileGraphicEvo`: HUD-level data, updated every rendered frame.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct Graphics {
    pub packet_id: i32,
    pub status: i32,
    pub focused_car_id: [u64; 2],
    pub player_car_id: [u64; 2],
    pub rpm: u16,
    /// 15 driver-aid / engine booleans (rpm limiter ... max charge reached).
    pub engine_flags: [u8; 15],
    pub display_speed_kmh: i16,
    pub display_speed_mph: i16,
    pub display_speed_ms: i16,
    pub pitspeeding_delta: f32,
    pub gear_int: i16,
    /// rpm%, gas, brake, handbrake, clutch, steering, ffb, car ffb, water temp%,
    /// water pressure, fuel pressure.
    pub inputs: [f32; 11],
    pub water_temperature_c: i8,
    pub air_temperature_c: i8,
    /// oil temp, oil pressure, exhaust temp, g x/y/z, turbo boost/level/perc.
    pub engine: [f32; 9],
    pub steer_degrees: i32,
    pub current_km: f32,
    pub total_km: u32,
    pub total_driving_time_s: u32,
    pub time_of_day: [i32; 3],
    pub delta_time_ms: i32,
    pub current_lap_time_ms: i32,
    pub predicted_lap_time_ms: i32,
    pub fuel: [f32; 4],
    pub current_torque: f32,
    pub current_bhp: i32,
    pub tyres: [[u32; 64]; 4],
    pub npos: f32,
    pub kers_charge_perc: f32,
    pub kers_current_perc: f32,
    pub control_lock_time: f32,
    pub car_damage: [u32; 32],
    pub car_location: i32,
    pub pit_info: [u32; 16],
    pub fuel_and_battery: [f32; 8],
    pub instrumentation: [[u32; 32]; 3],
    pub electronics: [[u32; 32]; 4],
    pub total_lap_count: i32,
    pub current_pos: u32,
    pub total_drivers: u32,
    pub last_laptime_ms: i32,
    pub best_laptime_ms: i32,
    pub flag: i32,
    pub global_flag: i32,
    pub max_gears: u32,
    pub engine_type: i32,
    pub has_kers: u8,
    pub is_last_lap: u8,
    pub performance_mode_name: [u8; 33],
    pub diff_coast_raw_value: f32,
    pub diff_power_raw_value: f32,
    pub race_cut_gained_time_ms: i32,
    pub distance_to_deadline: i32,
    pub race_cut_current_delta: f32,
    pub session_state: SessionState,
    pub timing_state: TimingState,
    pub player_stats: [i32; 8],
    pub driver_name: [u8; 33],
    pub driver_surname: [u8; 33],
    pub car_model: [u8; 33],
    pub is_in_pit_box: u8,
    pub is_in_pit_lane: u8,
    pub is_valid_lap: u8,
    pub car_coordinates: [[f32; 3]; 60],
    pub gap_ahead: f32,
    pub gap_behind: f32,
    pub active_cars: u8,
    pub fuel_per_lap: f32,
    pub fuel_estimated_laps: f32,
    pub assists_state: [u32; 16],
    pub max_fuel: f32,
    pub max_turbo_boost: f32,
    pub use_single_compound: u8,
    pub car_ids: [[u64; 2]; 60],
}

/// `SPageFileStaticEvo`: written once when a session loads.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct Static {
    pub sm_version: [u8; 15],
    pub ac_evo_version: [u8; 15],
    pub session: i32,
    pub session_name: [u8; 33],
    pub event_id: u8,
    pub session_id: u8,
    pub starting_grip: i32,
    pub starting_ambient_temperature_c: f32,
    pub starting_ground_temperature_c: f32,
    pub is_static_weather: u8,
    pub is_timed_race: u8,
    pub is_online: u8,
    pub number_of_sessions: i32,
    pub nation: [u8; 33],
    pub longitude: f32,
    pub latitude: f32,
    pub track: [u8; 33],
    pub track_configuration: [u8; 33],
    pub track_length_m: f32,
}

const _: () = assert!(size_of::<SessionState>() == 256);
const _: () = assert!(size_of::<TimingState>() == 256);
const _: () = assert!(size_of::<Static>() == 208);

/// Decodes a fixed-size, NUL-terminated C string field.
pub fn c_str(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}
