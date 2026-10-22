//! DiRT Rally 2.0 adapter: a rally game read over UDP.
//!
//! The game sends a 66-float packet about 72 times a second to every `<udp>` entry in its settings (see
//! `config.rs`, which adds Bin It's own so other tools keep theirs). The layout, and what was found when it
//! was read from a running game, is in `layout.rs` and `docs/telemetry-data.md`.
//!
//! Unlike the shared-memory games the data is pushed, not read on demand, so each poll drains every packet
//! that arrived since the last one and runs them all through the shared [`StageTracker`]. What is different
//! from the other rally game:
//! * the game says outright when the stage is finished (and its final time), so the finish is taken from
//!   the packet and nothing is inferred from the clock stopping;
//! * time penalties show as one-step jumps in the stage clock and are recorded with where they happened;
//! * there are no stage or car names in the data (see `known.rs`).

pub mod config;
pub mod identity;
pub mod known;
pub mod layout;

use std::time::{Duration, Instant};

use crate::stage::{StageSample, StageTracker};
use crate::{CompletedLap, GameAdapter, GameEvent, GameId, GamePhase, Inputs, LiveState, SessionInfo, TimingKind};
use config::ConfigStatus;
use layout::Packet;

/// The bundled list of locations. Stages are learned as they are driven (see `known.rs`).
pub const CATALOGUE_JSON: &str = include_str!("catalogue.json");

pub const PROCESS_NAME: &str = "dirtrally2.exe";

const CONNECTED_POLL: Duration = Duration::from_millis(20);
const DISCONNECTED_POLL: Duration = Duration::from_secs(2);
const LIVE_EVERY: Duration = Duration::from_millis(100);
/// The data counts as moving if the game's session clock changed within this long.
const ALIVE_MS: u64 = 1_000;
/// The car is on the start line (not yet over it) while its distance is no more than this, metres.
const START_LINE_M: f32 = 0.5;
/// While the game is not running its settings are checked this often (it rewrites them on exit).
const CONFIG_CHECK_EVERY: Duration = Duration::from_secs(30);

pub fn is_running() -> bool {
    crate::is_process_running(PROCESS_NAME)
}

/// The game-agnostic description of the stage being driven, from a packet and where the stage's start line
/// is (`None` when the stage was joined after the start, so the start was never seen).
pub fn session_info(p: &Packet, start: Option<[f32; 2]>) -> SessionInfo {
    let known = known::Known::bundled();
    SessionInfo {
        game: GameId::DirtRally2,
        track: known.stage_name(p.length_m, start),
        layout: p.has_stage().then(|| stage_variant(p.length_m)),
        car: known.car_name(p.max_rpm, p.idle_rpm, p.gears),
        session_kind: "Stage".to_string(),
        timing: TimingKind::RallyStage,
        length_m: p.has_stage().then(|| p.length_m.round() as u32),
        identity: p.has_stage().then(|| identity_json(p, start)),
    }
}

/// What the stage and car were told apart by, with their ids, for the dev tools to record a name against.
fn identity_json(p: &Packet, start: Option<[f32; 2]>) -> String {
    let round = |v: f32, places: f64| (v as f64 * places).round() / places;
    serde_json::json!({
        "stage": {
            "id": start.map(|s| identity::stage_id(p.length_m, s)),
            "length_m": round(p.length_m, 100.0),
            "start": start.map(|s| [round(s[0], 100.0), round(s[1], 100.0)]),
        },
        "car": {
            "id": identity::car_id(p.max_rpm, p.idle_rpm, p.gears),
            "max_rpm": round(p.max_rpm, 10.0),
            "idle_rpm": round(p.idle_rpm, 10.0),
            "gears": p.gears,
        },
    })
    .to_string()
}

/// A stage's second name: its length, to the nearest 10 m (two stages of a region can share a name).
pub fn stage_variant(length_m: f32) -> String {
    format!("{:.2} km", (length_m / 10.0).round() / 100.0)
}

/// What the driver is doing, as the game-agnostic inputs.
pub fn inputs(p: &Packet) -> Inputs {
    Inputs {
        throttle: p.throttle.clamp(0.0, 1.0),
        brake: p.brake.clamp(0.0, 1.0),
        clutch: p.clutch.clamp(0.0, 1.0),
        handbrake: 0.0,
        steering: p.steering.clamp(-1.0, 1.0),
        gear: p.gear,
        speed_kmh: p.speed_kmh(),
        rpm: p.rpm.clamp(0.0, u16::MAX as f32) as u16,
    }
}

/// Turns packets into events. Free of any socket so a recording can be played through it.
pub struct Dr2Stream {
    tracker: StageTracker,
    session: Option<SessionInfo>,
    last_session_s: Option<f32>,
    last_change_ms: u64,
    /// The finish was taken from a packet: the rest of the stream until the stage is left is not a run.
    finished: bool,
    last_live: Option<u64>,
    /// The stage's length and where its start line is, read before the clock started. A stage joined later has
    /// none, and then can't be told from the same length running the other way.
    start: Option<(f32, [f32; 2])>,
}

impl Default for Dr2Stream {
    fn default() -> Self {
        Self::new()
    }
}

impl Dr2Stream {
    pub fn new() -> Self {
        Self { tracker: StageTracker::with_penalties(), session: None, last_session_s: None, last_change_ms: 0, finished: false, last_live: None, start: None }
    }

    /// Forgets everything (the game closed or the socket was lost).
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// The data is still moving (a paused game repeats one packet, the stream stops between stages).
    pub fn alive(&self, now_ms: u64) -> bool {
        self.last_session_s.is_some() && now_ms.saturating_sub(self.last_change_ms) < ALIVE_MS
    }

    /// One packet, received `now_ms` after some fixed origin.
    pub fn packet(&mut self, p: &Packet, now_ms: u64) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let updating = self.last_session_s != Some(p.session_s);
        if updating {
            self.last_session_s = Some(p.session_s);
            self.last_change_ms = now_ms;
        }

        if !p.has_stage() {
            // The all-zero packet the game sends on leaving a stage: back to the menus.
            self.tracker.update(StageSample { at_ms: now_ms, clock_ms: None, distance_m: 0.0, length_m: None, updating, inputs: None, position: None });
            self.session = None;
            self.finished = false;
            self.start = None;
            return events;
        }

        // The start line is where the car stands before the go: the clock still at zero and not yet past the
        // line. Each such packet restates it, so a restart (or the next stage) takes its own.
        if p.stage_s == 0.0 && p.distance_m <= START_LINE_M {
            self.start = Some((p.length_m, p.position()));
        }
        let start = self.start.filter(|(length, _)| *length == p.length_m).map(|(_, at)| at);
        let info = session_info(p, start);
        if self.session.as_ref() != Some(&info) {
            // A different stage or car: a run in progress belongs to the old one.
            self.tracker.reset();
            self.finished = false;
            self.session = Some(info.clone());
            events.push(GameEvent::SessionChanged(info));
        }

        if p.complete {
            if !self.finished {
                self.finished = true;
                if let (Some(time_ms), Some(session)) = (p.final_time_ms(), self.session.clone())
                    && let Some(done) = self.tracker.finish_now(time_ms, p.distance_m)
                {
                    events.push(GameEvent::LapCompleted(CompletedLap {
                        session,
                        lap_number: done.attempt,
                        time_ms: done.time_ms,
                        valid: done.untimed.is_none(),
                        untimed: done.untimed,
                        sectors_ms: Vec::new(),
                        profile: done.profile,
                        trace: done.trace,
                        penalties: done.penalties,
                    }));
                }
            }
            return events;
        }
        self.finished = false;

        self.tracker.update(StageSample {
            at_ms: now_ms,
            clock_ms: p.clock_ms(),
            distance_m: p.distance_m,
            length_m: Some(p.length_m),
            updating,
            inputs: Some(inputs(p)),
            position: Some(p.position()),
        });
        events
    }

    /// The live state for the overlay, at most every [`LIVE_EVERY`].
    pub fn live(&mut self, p: &Packet, now_ms: u64) -> Option<GameEvent> {
        if self.last_live.is_some_and(|t| now_ms.saturating_sub(t) < LIVE_EVERY.as_millis() as u64) {
            return None;
        }
        self.last_live = Some(now_ms);
        let driving = p.has_stage() && !self.finished && self.alive(now_ms);
        Some(GameEvent::Live(LiveState {
            driving,
            phase: if driving { GamePhase::Driving } else { GamePhase::Menu },
            current_lap_ms: p.clock_ms().unwrap_or(0),
            lap_valid: true,
            out_lap: false,
            lap_progress: p.progress.clamp(0.0, 1.0),
            position: p.has_stage().then(|| p.position()),
            inputs: Some(inputs(p)),
            penalties: self.tracker.penalties().to_vec(),
        }))
    }
}

#[cfg(windows)]
pub use receiver::Receiver;

#[cfg(windows)]
mod receiver {
    use std::io;
    use std::net::UdpSocket;

    use super::config::{FIRST_PORT, PORT_TRIES};
    use super::layout::{PACKET_BYTES, Packet};

    /// A non-blocking UDP socket on the first free port from [`FIRST_PORT`].
    pub struct Receiver {
        socket: UdpSocket,
        pub port: u16,
        buf: [u8; 2048],
    }

    impl Receiver {
        pub fn bind() -> io::Result<Self> {
            let mut last = None;
            for port in FIRST_PORT..FIRST_PORT + PORT_TRIES {
                match UdpSocket::bind(("127.0.0.1", port)) {
                    Ok(socket) => {
                        socket.set_nonblocking(true)?;
                        return Ok(Self { socket, port, buf: [0; 2048] });
                    }
                    Err(e) => last = Some(e),
                }
            }
            Err(last.unwrap_or_else(|| io::Error::other("no port")))
        }

        /// The next packet waiting, if any (other sizes are the wrong `extradata` and are skipped).
        pub fn recv(&mut self) -> Option<Packet> {
            loop {
                match self.socket.recv_from(&mut self.buf) {
                    Ok((n, _)) if n == PACKET_BYTES => return Packet::parse(&self.buf[..n]),
                    Ok(_) => continue,
                    Err(_) => return None,
                }
            }
        }
    }
}

/// The DiRT Rally 2.0 [`GameAdapter`].
pub struct Dr2Adapter {
    #[cfg(windows)]
    receiver: Option<Receiver>,
    stream: Dr2Stream,
    status: ConfigStatus,
    port: u16,
    started: Instant,
    last_config_check: Option<Instant>,
    last_packet: Option<Packet>,
}

impl Default for Dr2Adapter {
    fn default() -> Self {
        Self::new()
    }
}

impl Dr2Adapter {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            receiver: None,
            stream: Dr2Stream::new(),
            status: ConfigStatus::Unknown,
            port: config::FIRST_PORT,
            started: Instant::now(),
            last_config_check: None,
            last_packet: None,
        }
    }

    /// Whether the game's settings have Bin It's UDP entry, and whether a restart is needed for it.
    pub fn config_status(&self) -> ConfigStatus {
        self.status
    }

    fn check_config(&mut self, game_running: bool) {
        let Some(path) = config::documents_dir().map(|d| config::config_path(&d)) else {
            return;
        };
        let status = config::ensure_configured(&path, self.port, game_running);
        // A restart is still needed until packets arrive; don't forget that on the next check.
        self.status = match (self.status, status) {
            (ConfigStatus::RestartNeeded, ConfigStatus::Ready) => ConfigStatus::RestartNeeded,
            (_, s) => s,
        };
    }
}

impl GameAdapter for Dr2Adapter {
    fn game(&self) -> GameId {
        GameId::DirtRally2
    }

    fn timing_kind(&self) -> TimingKind {
        TimingKind::RallyStage
    }

    fn poll_interval(&self) -> Duration {
        #[cfg(windows)]
        if self.receiver.is_some() {
            return CONNECTED_POLL;
        }
        DISCONNECTED_POLL
    }

    #[cfg(not(windows))]
    fn poll(&mut self) -> Vec<GameEvent> {
        Vec::new()
    }

    #[cfg(windows)]
    fn poll(&mut self) -> Vec<GameEvent> {
        let mut events = Vec::new();
        let running = is_running();

        if self.receiver.is_none() {
            // The settings are checked while the game is closed, so the entry is in place before it starts
            // (and the game, which rewrites the file as it exits, gets it back on the next check).
            if self.last_config_check.is_none_or(|t| t.elapsed() >= CONFIG_CHECK_EVERY) {
                self.last_config_check = Some(Instant::now());
                self.check_config(running);
            }
            if !running {
                return events;
            }
            match Receiver::bind() {
                Ok(receiver) => {
                    if receiver.port != self.port {
                        self.port = receiver.port;
                        self.check_config(true);
                    }
                    self.receiver = Some(receiver);
                    events.push(GameEvent::Connected { game: GameId::DirtRally2, game_version: String::new() });
                }
                Err(_) => return events,
            }
        }
        if !running {
            self.receiver = None;
            self.stream.reset();
            self.last_packet = None;
            self.status = ConfigStatus::Unknown;
            self.last_config_check = None;
            events.push(GameEvent::Disconnected { game: GameId::DirtRally2 });
            return events;
        }

        let now_ms = self.started.elapsed().as_millis() as u64;
        let receiver = self.receiver.as_mut().expect("bound above");
        while let Some(p) = receiver.recv() {
            events.extend(self.stream.packet(&p, now_ms));
            if self.status == ConfigStatus::RestartNeeded {
                self.status = ConfigStatus::Ready;
            }
            self.last_packet = Some(p);
        }
        if let Some(p) = self.last_packet
            && let Some(live) = self.stream.live(&p, now_ms)
        {
            events.push(live);
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Penalty, UntimedReason};

    /// The recorded run, as packets: a 2.85 km stage with three 4 s penalties, finished in 3:12.557.
    fn recorded_run() -> Vec<Packet> {
        include_str!("fixtures/penalty_run.csv")
            .lines()
            .filter(|l| !l.starts_with('#') && !l.starts_with("session_s"))
            .map(|line| {
                let f: Vec<f32> = line.split(',').map(|v| v.parse().unwrap()).collect();
                Packet {
                    session_s: f[0],
                    stage_s: f[1],
                    distance_m: f[2],
                    progress: f[3],
                    x: f[4],
                    z: f[5],
                    speed_ms: f[6],
                    throttle: f[7],
                    steering: f[8],
                    brake: f[9],
                    gear: f[10] as i16,
                    rpm: f[11],
                    splits: f[12] as u8,
                    complete: f[13] >= 1.0,
                    length_m: f[14],
                    final_s: f[15],
                    max_rpm: 7_330.0,
                    idle_rpm: 1_466.0,
                    gears: 6,
                    ..Packet::default()
                }
            })
            .collect()
    }

    fn play(packets: &[Packet]) -> Vec<GameEvent> {
        let mut stream = Dr2Stream::new();
        let mut events = Vec::new();
        for p in packets {
            events.extend(stream.packet(p, (p.session_s * 1000.0) as u64));
        }
        events
    }

    /// The recording's last attempt, from the packets before the go (the recording began part-way through an
    /// earlier attempt, which was restarted), so the start line is seen.
    fn from_the_start_line(run: &[Packet]) -> Vec<Packet> {
        let on_line = |p: &Packet| p.stage_s == 0.0 && p.distance_m <= 0.5 && p.has_stage();
        let last = run.iter().rposition(on_line).expect("a packet on the start line");
        let first = (0..=last).rev().take_while(|&i| on_line(&run[i])).last().unwrap();
        run[first..].to_vec()
    }

    fn completed(events: &[GameEvent]) -> Vec<&CompletedLap> {
        events.iter().filter_map(|e| if let GameEvent::LapCompleted(l) = e { Some(l) } else { None }).collect()
    }

    #[test]
    fn a_recorded_run_with_three_penalties_is_one_timed_run_with_the_games_time() {
        let events = play(&recorded_run());
        let laps = completed(&events);
        assert_eq!(laps.len(), 1, "one finish");
        let lap = laps[0];
        assert_eq!(lap.time_ms, 192_557, "3:12.557 as the game showed it");
        assert_eq!((lap.untimed, lap.valid, lap.lap_number), (None, true, 1));
        assert!(lap.profile.is_some() && lap.trace.is_some(), "a whole run was sampled");
        assert_eq!(lap.session.timing, TimingKind::RallyStage);
        assert_eq!(lap.session.layout.as_deref(), Some("2.85 km"));
    }

    #[test]
    fn each_penalty_is_recorded_with_its_size_and_where_it_happened() {
        let events = play(&recorded_run());
        let penalties: &[Penalty] = &completed(&events)[0].penalties;
        assert_eq!(penalties.len(), 3, "{penalties:?}");
        assert!(penalties.iter().all(|p| p.added_ms == 4_000), "{penalties:?}");
        assert_eq!(penalties.iter().map(|p| p.added_ms).sum::<u32>(), 12_000, "the 12 s the game showed");
        // One near the start (46 m of 2 846 m) and two near the end, in the order they happened.
        assert!(penalties[0].progress < 0.05, "{}", penalties[0].progress);
        assert!(penalties[1].progress > 0.9 && penalties[2].progress > penalties[1].progress);
        assert!(penalties[0].at_ms < penalties[1].at_ms && penalties[1].at_ms < penalties[2].at_ms);
        assert!(penalties.iter().all(|p| p.position.is_some()));
    }

    #[test]
    fn a_stage_left_part_way_and_started_again_is_not_a_result() {
        let run = recorded_run();
        // Drive 400 packets in, then the game goes to the menus (the all-zero packet), then the whole run again.
        let mut packets: Vec<Packet> = run[..400].to_vec();
        packets.push(Packet::default());
        let offset = run[399].session_s + 5.0;
        packets.extend(run.iter().map(|p| Packet { session_s: p.session_s + offset, ..*p }));
        let events = play(&packets);
        let laps = completed(&events);
        assert_eq!(laps.len(), 1);
        assert_eq!(laps[0].untimed, None);
        assert_eq!(laps[0].time_ms, 192_557);
    }

    #[test]
    fn the_packets_after_the_finish_are_not_another_run() {
        let mut packets = recorded_run();
        let last = *packets.last().unwrap();
        // The game repeats the finish packet a few times, then sends the all-zero packet.
        for i in 1..=3 {
            packets.push(Packet { session_s: last.session_s + 0.015 * i as f32, ..last });
        }
        packets.push(Packet::default());
        assert_eq!(completed(&play(&packets)).len(), 1);
    }

    #[test]
    fn joining_a_stage_part_way_is_not_trusted() {
        let run = recorded_run();
        let from = run.iter().position(|p| p.stage_s > 60.0).unwrap();
        let events = play(&run[from..]);
        let laps = completed(&events);
        assert_eq!(laps.len(), 1);
        assert_eq!(laps[0].untimed, Some(UntimedReason::Partial));
        assert!(laps[0].profile.is_none());
    }

    #[test]
    fn a_jump_start_is_a_ten_second_penalty_at_the_line_not_a_partial_run() {
        // The clock reads 0 before the go and 10.000 on its first tick (recorded on a real jump start).
        let base = Packet { length_m: 1_000.0, max_rpm: 7_330.0, idle_rpm: 1_466.0, gears: 6, ..Packet::default() };
        let mut packets = vec![
            Packet { session_s: 1.0, stage_s: 0.0, distance_m: -2.3, ..base },
            Packet { session_s: 1.1, stage_s: 0.0, distance_m: -2.3, ..base },
            Packet { session_s: 1.2, stage_s: 10.0, distance_m: -2.2, ..base },
        ];
        for i in 0..60 {
            let d = 15.0 * i as f32;
            packets.push(Packet { session_s: 1.3 + 0.5 * i as f32, stage_s: 10.0 + 0.5 * i as f32, distance_m: d, progress: d / 1_000.0, ..base });
        }
        packets.push(Packet { session_s: 40.0, stage_s: 0.0, distance_m: 1_001.0, progress: 2.0, complete: true, final_s: 41.2, ..base });
        let events = play(&packets);
        let laps = completed(&events);
        assert_eq!(laps.len(), 1);
        assert_eq!(laps[0].untimed, None, "the 10 s was the penalty, not a run joined late");
        assert_eq!(laps[0].time_ms, 41_200);
        assert_eq!(laps[0].penalties.len(), 1);
        assert_eq!((laps[0].penalties[0].added_ms, laps[0].penalties[0].at_ms), (10_000, 0));
    }

    #[test]
    fn the_live_state_counts_penalties_as_they_are_taken_and_starts_again_with_a_new_run() {
        let run = recorded_run();
        let mut stream = Dr2Stream::new();
        let mut counts = Vec::new();
        for p in &run {
            let now = (p.session_s * 1000.0) as u64;
            stream.packet(p, now);
            // (From the finish packet on the run's penalties belong to its result, not the live state.)
            if !p.complete
                && let Some(GameEvent::Live(l)) = stream.live(p, now + 10_000 * counts.len() as u64)
            {
                counts.push(l.penalties.len());
            }
        }
        assert_eq!(counts.iter().copied().max(), Some(3));
        assert!(counts.windows(2).all(|w| w[1] >= w[0]), "never goes down during a run: {counts:?}");
        // Leaving the stage and starting again: no penalties carried over.
        stream.packet(&Packet::default(), 900_000_000);
        stream.packet(&run[0], 900_000_100);
        let Some(GameEvent::Live(l)) = stream.live(&run[0], 1_000_000_000) else { panic!("live state") };
        assert!(l.penalties.is_empty());
    }

    #[test]
    fn an_unnamed_stage_and_car_are_called_unknown_with_their_stable_ids() {
        let run = recorded_run();
        let start = run.iter().find(|p| p.stage_s == 0.0 && p.distance_m <= 0.5).expect("a packet before the go");
        let info = session_info(start, Some(start.position()));
        assert_eq!(info.game, GameId::DirtRally2);
        assert_eq!(info.layout.as_deref(), Some("2.85 km"));
        assert_eq!(info.track, "Unknown stage 8B2484", "the id of this stage's length and start line");
        assert!(known::id_in_label(&info.car).is_some() && info.car.starts_with("Unknown car "), "{}", info.car);
    }

    #[test]
    fn the_stream_names_a_stage_from_where_it_started_not_from_where_the_car_is() {
        let run = from_the_start_line(&recorded_run());
        let events = play(&run);
        let sessions: Vec<&SessionInfo> = events.iter().filter_map(|e| if let GameEvent::SessionChanged(i) = e { Some(i) } else { None }).collect();
        assert_eq!(sessions.len(), 1, "one stage");
        assert_eq!(sessions[0].track, "Unknown stage 8B2484");
        // The run's result carries the same stage, not one labelled by wherever the car was at the finish.
        assert_eq!(completed(&events)[0].session.track, "Unknown stage 8B2484");
    }

    #[test]
    fn the_same_length_run_from_the_other_end_is_another_stage() {
        let run = from_the_start_line(&recorded_run());
        // The same stage driven the other way round starts where it finished: put the start somewhere else.
        let elsewhere: Vec<Packet> = run.iter().map(|p| Packet { x: p.x + 1500.0, z: p.z - 600.0, ..*p }).collect();
        let a = play(&run);
        let b = play(&elsewhere);
        let track = |events: &[GameEvent]| match &events[0] {
            GameEvent::SessionChanged(i) => i.track.clone(),
            other => panic!("{other:?}"),
        };
        assert_ne!(track(&a), track(&b));
        assert_eq!(track(&b).len(), "Unknown stage 8B2484".len());
    }

    #[test]
    fn a_stage_joined_after_the_start_has_no_start_to_name_it_by() {
        let run = recorded_run();
        let from = run.iter().position(|p| p.stage_s > 60.0).unwrap();
        let events = play(&run[from..]);
        let GameEvent::SessionChanged(info) = &events[0] else { panic!("{:?}", events[0]) };
        assert_eq!(info.track, "Unknown stage 2.85 km (start not seen)");
    }

    #[test]
    fn a_restart_reads_the_start_line_again_and_keeps_the_same_stage() {
        let run = from_the_start_line(&recorded_run());
        // Part-way in, then the clock and distance go back to the start line, then the whole run again.
        let mut packets: Vec<Packet> = run[..400].to_vec();
        let offset = run[399].session_s + 3.0;
        packets.extend(run.iter().map(|p| Packet { session_s: p.session_s + offset, ..*p }));
        let events = play(&packets);
        let sessions = events.iter().filter(|e| matches!(e, GameEvent::SessionChanged(_))).count();
        assert_eq!(sessions, 1, "same stage throughout: not announced twice");
    }

    #[test]
    fn the_catalogue_is_valid() {
        let v: serde_json::Value = serde_json::from_str(CATALOGUE_JSON).unwrap();
        assert_eq!(v["tracks"].as_array().unwrap().len(), 12);
    }
}
