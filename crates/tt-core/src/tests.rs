use super::*;
use tt_games::{CompletedLap, GameId, SessionInfo, UntimedReason};

fn session(car: &str) -> SessionInfo {
    SessionInfo {
        game: GameId::AssettoCorsaEvo,
        track: "Imola".into(),
        layout: None,
        car: car.into(),
        session_kind: "Hot Stint".into(),
        timing: tt_games::TimingKind::CircuitLap,
        length_m: Some(4909),
    }
}

fn lap(time_ms: u32, valid: bool) -> CompletedLap {
    let untimed = (!valid).then_some(UntimedReason::Cut);
    CompletedLap { session: session("Porsche 992 GT3 R"), lap_number: 1, time_ms, valid, untimed, sectors_ms: vec![], profile: None, trace: None }
}

fn untimed_lap(time_ms: u32, reason: UntimedReason) -> CompletedLap {
    CompletedLap { untimed: Some(reason), ..lap(time_ms, false) }
}

#[test]
fn out_and_in_laps_are_never_ranked_or_counted_as_attempts() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let out = tt.record_lap(&untimed_lap(95_000, UntimedReason::OutLap)).unwrap();
    assert_eq!(out.lap.untimed_reason.as_deref(), Some("outLap"));
    tt.record_lap(&lap(102_318, true)).unwrap();
    tt.record_lap(&untimed_lap(96_000, UntimedReason::InLap)).unwrap();

    // Even with cut laps included, out/in laps don't show up.
    let board = tt.leaderboard(&LeaderboardQuery { include_invalid: true, ..imola_board() }).unwrap();
    assert_eq!(board.len(), 1);
    assert_eq!((board[0].time_ms, board[0].lap_count), (102_318, 1));

    // And they don't use up a one-lap challenge allowance.
    let one_lap = tt.leaderboard(&LeaderboardQuery { max_laps: Some(1), ..imola_board() }).unwrap();
    assert_eq!(one_lap[0].time_ms, 102_318);
}

fn imola_board() -> LeaderboardQuery {
    LeaderboardQuery { game: "acevo".into(), track: "Imola".into(), ..Default::default() }
}

#[test]
fn adding_an_existing_name_returns_that_driver() {
    let tt = TimeTrial::in_memory().unwrap();
    let a = tt.add_driver("Sam", None).unwrap();
    let b = tt.add_driver("  sam ", None).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(tt.drivers().unwrap().len(), 1);
}

#[test]
fn laps_go_to_whoever_is_in_the_seat() {
    let tt = TimeTrial::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    let r = tt.record_lap(&lap(102_318, true)).unwrap();
    assert_eq!(r.lap.driver_id, Some(sam.id));
    assert!(r.personal_best);
    assert!(r.combo_record);

    tt.set_seat(None).unwrap();
    let guest = tt.record_lap(&lap(101_000, true)).unwrap();
    assert_eq!(guest.lap.driver_id, None);
    assert!(!guest.personal_best);

    tt.claim_lap(guest.lap.id, Some(sam.id)).unwrap();
    let board = tt.leaderboard(&imola_board()).unwrap();
    assert_eq!(board.len(), 1);
    assert_eq!(board[0].time_ms, 101_000);
    assert_eq!(board[0].lap_count, 2);
}

#[test]
fn leaderboard_ranks_best_valid_lap_per_driver() {
    let tt = TimeTrial::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&lap(103_000, true)).unwrap();
    tt.record_lap(&lap(99_000, false)).unwrap(); // cut: doesn't count
    tt.record_lap(&lap(102_318, true)).unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    tt.record_lap(&lap(102_114, true)).unwrap();

    let board = tt.leaderboard(&imola_board()).unwrap();
    assert_eq!(board.iter().map(|e| (e.driver_id, e.time_ms, e.gap_ms)).collect::<Vec<_>>(), vec![
        (Some(jess.id), 102_114, 0),
        (Some(sam.id), 102_318, 204),
    ]);

    let with_invalid = tt.leaderboard(&LeaderboardQuery { include_invalid: true, ..imola_board() }).unwrap();
    assert_eq!(with_invalid[0].time_ms, 99_000);
}

#[test]
fn challenge_tracks_position_changes_and_attempt_limit() {
    let tt = TimeTrial::in_memory().unwrap();
    let challenge = tt
        .create_challenge(&NewChallenge {
            name: "Imola Hot Lap Week".into(),
            game: "acevo".into(),
            track: "Imola".into(),
            layout: String::new(),
            car: Some("Porsche 992 GT3 R".into()),
            starts_at: Some(0),
            ends_at: None,
            valid_only: true,
            max_laps: Some(2),
            prizes: vec![],
        })
        .unwrap();

    tt.add_and_seat("Jess", None).unwrap();
    tt.record_lap(&lap(102_114, true)).unwrap();

    tt.add_and_seat("Sam", None).unwrap();
    let first = tt.record_lap(&lap(103_000, true)).unwrap();
    assert_eq!(first.challenges[0].position, Some(2));
    assert_eq!(first.challenges[0].previous_position, None);

    let second = tt.record_lap(&lap(101_900, true)).unwrap();
    assert_eq!(second.challenges[0].previous_position, Some(2));
    assert_eq!(second.challenges[0].position, Some(1));
    assert_eq!(second.challenges[0].gap_to_leader_ms, Some(0));

    // Third attempt is over the limit, so even a faster lap doesn't count.
    tt.record_lap(&lap(100_000, true)).unwrap();
    let board = tt.challenge_leaderboard(challenge.id).unwrap();
    assert_eq!(board[0].time_ms, 101_900);

    // A different car doesn't count towards a single-car challenge.
    let other_car = CompletedLap { session: session("bmw_m4_gt3"), ..lap(90_000, true) };
    assert!(tt.record_lap(&other_car).unwrap().challenges.is_empty());
}

#[test]
fn game_events_drive_session_and_laps() {
    let tt = TimeTrial::in_memory().unwrap();
    let mut rx = tt.subscribe();
    tt.handle_game_event(GameEvent::Connected { game: GameId::AssettoCorsaEvo, game_version: "0.5".into() }).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(102_000, true))).unwrap();

    let status = tt.status().unwrap();
    assert!(status.connected);
    assert_eq!(status.session.unwrap().combo.track, "Imola");

    let mut saw_lap = false;
    while let Ok(ev) = rx.try_recv() {
        saw_lap |= matches!(ev, AppEvent::LapRecorded { .. });
    }
    assert!(saw_lap);
}

#[test]
fn database_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tt.db");
    {
        let tt = TimeTrial::open(&path).unwrap();
        tt.add_and_seat("Sam", Some("#ff9f6b")).unwrap();
        tt.record_lap(&lap(102_318, true)).unwrap();
    }
    let tt = TimeTrial::open(&path).unwrap();
    assert_eq!(tt.drivers().unwrap()[0].color, "#FF9F6B");
    assert!(tt.seat().unwrap().is_some());
    assert_eq!(tt.recent_laps(10).unwrap().len(), 1);
}

/// A lap driven at constant speed, sampled every 0.5%.
fn profiled_lap(time_ms: u32) -> CompletedLap {
    use tt_games::timing::ProfileRecorder;
    let mut r = ProfileRecorder::default();
    for i in 0..200 {
        r.push(i as f32 / 200.0, time_ms * i / 200);
    }
    CompletedLap { profile: r.finish(time_ms), ..lap(time_ms, true) }
}

#[test]
fn laps_are_split_into_sectors_with_timing_colours() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    assert_eq!(tt.status().unwrap().session.unwrap().sector_count, 3);

    tt.add_and_seat("Jess", None).unwrap();
    let first = tt.record_lap(&profiled_lap(99_000)).unwrap();
    assert_eq!(first.lap.sectors_ms, vec![33_000, 33_000, 33_000]);
    assert!(first.sector_status.iter().all(|s| *s == live::SectorStatus::Purple));

    tt.add_and_seat("Sam", None).unwrap();
    let slower = tt.record_lap(&profiled_lap(102_000)).unwrap();
    // Slower than Jess everywhere, but Sam's first lap: personal bests, so green.
    assert!(slower.sector_status.iter().all(|s| *s == live::SectorStatus::Green));
    let again = tt.record_lap(&profiled_lap(103_500)).unwrap();
    assert!(again.sector_status.iter().all(|s| *s == live::SectorStatus::Yellow));

    let board = tt.leaderboard(&imola_board()).unwrap();
    assert_eq!(board[0].sectors_ms, vec![33_000, 33_000, 33_000]);
    assert_eq!(board[1].best_sectors_ms, vec![Some(34_000); 3]);
}

#[test]
fn live_timing_compares_against_the_seated_drivers_pb() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&profiled_lap(100_000)).unwrap();

    let mut rx = tt.subscribe();
    let live = |p: f32, t: u32| GameEvent::Live(tt_games::LiveState { driving: true, phase: tt_games::GamePhase::Driving, current_lap_ms: t, lap_valid: true, out_lap: false, lap_progress: p, position: None, inputs: None });
    tt.handle_game_event(live(0.0, 0)).unwrap();
    tt.handle_game_event(live(0.25, 24_000)).unwrap();
    tt.handle_game_event(live(0.40, 38_500)).unwrap();

    let mut last = None;
    while let Ok(ev) = rx.try_recv() {
        if let AppEvent::Live { live } = ev {
            last = live.timing;
        }
    }
    let t = last.expect("timing");
    assert_eq!(t.reference.as_deref(), Some("PB"));
    assert_eq!(t.delta_ms, Some(-1_500)); // 38.5 s vs 40 s at 40%
    assert_eq!(t.current_sector, 1);
    // S1 (1/3) crossed at ~32.0 s vs PB 33.3 s.
    assert_eq!(t.sectors[0].status, live::SectorStatus::Purple);
}

#[test]
fn a_clean_lap_teaches_the_track_map_once_and_flags_the_catalogue() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let drive = |tt: &TimeTrial, radius: f32| {
        for i in 0..800 {
            let p = i as f32 / 800.0;
            let a = p * std::f32::consts::TAU;
            tt.handle_game_event(GameEvent::Live(tt_games::LiveState {
                driving: true,
                phase: tt_games::GamePhase::Driving,
                current_lap_ms: i * 100,
                lap_valid: true,
                out_lap: false,
                lap_progress: p,
                position: Some([a.cos() * radius, a.sin() * radius]),
                inputs: None,
            }))
            .unwrap();
        }
    };

    // A cut lap teaches nothing.
    drive(&tt, 400.0);
    tt.handle_game_event(GameEvent::LapCompleted(untimed_lap(100_000, UntimedReason::Cut))).unwrap();
    assert!(tt.track_maps("acevo").unwrap().is_empty());

    // The first clean lap does; later laps don't overwrite it.
    drive(&tt, 400.0);
    tt.handle_game_event(GameEvent::LapCompleted(lap(100_000, true))).unwrap();
    drive(&tt, 800.0);
    tt.handle_game_event(GameEvent::LapCompleted(lap(99_000, true))).unwrap();
    let maps = tt.track_maps("acevo").unwrap();
    assert_eq!(maps.len(), 1);
    assert_eq!((maps[0].track.as_str(), maps[0].points.len()), ("Imola", 400));
    assert!((maps[0].points[0][0] - 400.0).abs() < 5.0);

    let cat = tt.catalogue("acevo").unwrap();
    let imola = cat.tracks.iter().find(|t| t.name == "Imola").unwrap();
    assert!(imola.seen && imola.layouts[0].has_map);
    assert!(cat.cars.iter().any(|c| c.name == "Porsche 992 GT3 R" && c.seen));
    // Seeded-but-undriven tracks are still offered.
    assert!(cat.tracks.iter().any(|t| t.name == "Suzuka" && !t.seen));
}

/// Drives the real AC EVO lap tracker into core like the adapter does, and returns what the
/// timing widget would show at a few moments of each lap: (label, out_lap, timing?, delta?, sector times).
fn simulate_widget(laps_after_out: u32, counted_out_lap: bool) -> Vec<(String, bool, bool, Option<i32>, usize)> {
    use tt_games::acevo::{LapTracker, Sample};
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let mut rx = tt.subscribe();
    let mut tr = LapTracker::default();
    let mut out = Vec::new();
    let mut lap_count = 0;
    let mut last_lap = 0;
    let lap_ms = 100_000i32;
    // (start progress, in pit lane at start) for the out lap, then full laps.
    let mut step = 0u32;
    let mut run = |tt: &TimeTrial, tr: &mut LapTracker, start: f32, lap_label: String, lap_count: &mut i32, last_lap: &mut i32, counted: bool, from_pits: bool, out: &mut Vec<(String, bool, bool, Option<i32>, usize)>| {
        let len = (((1.0 - start) * lap_ms as f32) / 50.0) as u32;
        for i in 0..=len {
            let p = (start + (i as f32 / len as f32) * (1.0 - start)).min(0.9999);
            let cur = if from_pits && !counted { 0 } else { (p * lap_ms as f32 - start * lap_ms as f32).max(0.0) as i32 };
            let s = Sample { status: tt_games::acevo::layout::STATUS_LIVE, lap_count: *lap_count, last_lap_ms: *last_lap, current_lap_ms: cur, lap_valid: true, in_pit_lane: from_pits && p < 0.55, progress: p, inputs: None };
            if let Some(l) = tr.update(s) {
                tt.handle_game_event(GameEvent::LapCompleted(CompletedLap { session: session("Porsche 992 GT3 R"), lap_number: l.lap_number, time_ms: l.time_ms, valid: l.untimed.is_none(), untimed: l.untimed, sectors_ms: vec![], profile: l.profile, trace: l.trace })).unwrap();
            }
            step += 1;
            if step % 2 == 0 {
                tt.handle_game_event(GameEvent::Live(tt_games::LiveState { driving: true, phase: tt_games::GamePhase::Driving, current_lap_ms: cur.max(0) as u32, lap_valid: true, out_lap: tr.on_out_lap(), lap_progress: p, position: None, inputs: None })).unwrap();
                while let Ok(ev) = rx.try_recv() {
                    if let AppEvent::Live { live } = ev && (((p * 100.0) as u32) % 20 == 10 || (p * 100.0) as u32 == 1) && out.last().is_none_or(|r| r.0 != format!("{lap_label}@{}%", (p * 100.0) as u32)) {
                        out.push((format!("{lap_label}@{}%", (p * 100.0) as u32), live.out_lap, live.timing.is_some(), live.timing.as_ref().and_then(|t| t.delta_ms), live.timing.as_ref().map_or(0, |t| t.sectors.iter().filter(|s| s.time_ms.is_some()).count())));
                    }
                }
            }
        }
        // Cross the line: the game's counter ticks (or not, for an uncounted out lap) and publishes the time.
        if counted {
            *lap_count += 1;
            *last_lap = lap_ms;
        }
    };
    // Out lap: from the pit exit (95%) to the line.
    run(&tt, &mut tr, 0.5, "out".into(), &mut lap_count, &mut last_lap, counted_out_lap, true, &mut out);
    for n in 1..=laps_after_out {
        run(&tt, &mut tr, 0.0, format!("lap{n}"), &mut lap_count, &mut last_lap, true, false, &mut out);
    }
    out
}

#[test]
fn timing_widget_is_live_from_the_first_flying_lap_but_the_delta_needs_a_reference() {
    for counted_out_lap in [false, true] {
        let rows = simulate_widget(2, counted_out_lap);
        // The out lap is flagged and has no timing; nothing is "late" after the line.
        assert!(rows.iter().filter(|r| r.0.starts_with("out")).all(|r| r.1 && !r.2));
        let lap1: Vec<_> = rows.iter().filter(|r| r.0.starts_with("lap1")).collect();
        assert!(lap1.iter().all(|r| !r.1 && r.2), "timing is on for the whole first flying lap");
        assert_eq!(lap1.last().unwrap().4, 2, "sector splits fill in on the first flying lap");
        // No reference yet, so no delta (the UI shows the lap clock instead); lap 2 compares to lap 1.
        assert!(lap1.iter().all(|r| r.3.is_none()));
        assert!(rows.iter().filter(|r| r.0.starts_with("lap2")).all(|r| r.3.is_some()));
    }
}

#[test]
fn map_orientation_is_saved_and_validated() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.store().set_track_map("acevo", "Imola", "", &[[0.0, 0.0], [1.0, 1.0]], 1).unwrap();
    assert!(tt.set_map_view("acevo", "Imola", "", 45, false).is_err());
    tt.set_map_view("acevo", "Imola", "", 90, true).unwrap();
    let m = &tt.track_maps("acevo").unwrap()[0];
    assert_eq!((m.rotate, m.mirror), (90, true));
}

#[test]
fn spellings_converge_and_old_data_is_migrated_to_catalogue_names() {
    let tt = TimeTrial::in_memory().unwrap();
    // Laps recorded before the catalogue knew the names: the game's spelling, plus a bathurst alias.
    let mut old = lap(100_000, true);
    old.session.track = "Bathurst".into();
    old.session.car = "Porsche 992 GT3 Cup".into();
    let combo = combo_of(&old.session);
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap_at(&old, 1_000).unwrap();
    assert_eq!(tt.combos(None).unwrap()[0].track, "Bathurst");
    assert_eq!(tt.canonicalize_history("acevo").unwrap(), 2);
    let c = &tt.combos(None).unwrap()[0];
    assert_eq!((c.track.as_str(), c.car.as_str()), ("Mount Panorama", "Porsche 911 GT3 Cup (992)"));
    assert_eq!(tt.canonicalize_history("acevo").unwrap(), 0);
    let _ = combo;

    // The game's own spelling now lands on the same entry as a challenge made from the catalogue.
    let challenge = tt
        .create_challenge(&NewChallenge {
            name: "Cup".into(),
            game: "acevo".into(),
            track: "Mount Panorama".into(),
            layout: String::new(),
            car: Some("Porsche 992 GT3 Cup".into()),
            starts_at: Some(0),
            ends_at: None,
            valid_only: true,
            max_laps: None,
            prizes: vec![],
        })
        .unwrap();
    assert_eq!(challenge.car.as_deref(), Some("Porsche 992 GT3 Cup"));
}

#[test]
fn the_reference_is_only_called_pb_when_it_is_the_pb() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    // The fastest lap has no profile (the game's clock glitched); a slower one does.
    tt.record_lap(&lap(53_820, true)).unwrap();
    tt.record_lap(&profiled_lap(55_668)).unwrap();

    let mut rx = tt.subscribe();
    let live = |p: f32, t: u32| GameEvent::Live(tt_games::LiveState { driving: true, phase: tt_games::GamePhase::Driving, current_lap_ms: t, lap_valid: true, out_lap: false, lap_progress: p, position: None, inputs: None });
    tt.handle_game_event(live(0.0, 0)).unwrap();
    tt.handle_game_event(live(0.3, 16_000)).unwrap();
    let mut label = None;
    while let Ok(ev) = rx.try_recv() {
        if let AppEvent::Live { live } = ev {
            label = live.timing.and_then(|t| t.reference);
        }
    }
    assert_eq!(label.as_deref(), Some("0:55.668"));

    // Once the real PB has a profile, it is the reference and is called PB.
    tt.record_lap(&profiled_lap(53_500)).unwrap();
    tt.handle_game_event(live(0.0, 0)).unwrap();
    tt.handle_game_event(live(0.3, 16_000)).unwrap();
    while let Ok(ev) = rx.try_recv() {
        if let AppEvent::Live { live } = ev {
            label = live.timing.and_then(|t| t.reference);
        }
    }
    assert_eq!(label.as_deref(), Some("PB"));
}

#[test]
fn laps_can_be_deleted_by_track_layout_and_car() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let mut lap_at = |track: &str, layout: &str, car: &str, ms: u32| {
        let mut l = lap(ms, true);
        l.session.track = track.into();
        l.session.layout = (!layout.is_empty()).then(|| layout.to_string());
        l.session.car = car.into();
        tt.record_lap(&l).unwrap();
    };
    lap_at("Suzuka", "East", "Dallara EXP", 54_000);
    lap_at("Suzuka", "East", "Ferrari F2004", 55_000);
    lap_at("Suzuka", "GP", "Dallara EXP", 90_000);
    lap_at("Imola", "", "Dallara EXP", 100_000);

    let all_suzuka = LapFilter { game: "acevo".into(), track: "Suzuka".into(), layout: None, car: None, forget_map: false };
    assert_eq!(tt.count_laps(&all_suzuka).unwrap(), 3);
    assert_eq!(tt.count_laps(&LapFilter { layout: Some("East".into()), ..all_suzuka.clone() }).unwrap(), 2);
    assert_eq!(tt.count_laps(&LapFilter { car: Some("Dallara EXP".into()), ..all_suzuka.clone() }).unwrap(), 2);

    let mut rx = tt.subscribe();
    assert_eq!(tt.delete_laps(&LapFilter { layout: Some("East".into()), ..all_suzuka.clone() }).unwrap(), 2);
    assert!(matches!(rx.try_recv(), Ok(AppEvent::LapsChanged)));
    assert_eq!(tt.delete_laps(&all_suzuka).unwrap(), 1);
    // Other tracks are untouched.
    assert_eq!(tt.combos(None).unwrap().len(), 1);
}

#[test]
fn a_laps_input_trace_is_stored_with_it() {
    use tt_games::timing::{LapTrace, TracePoint};
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let points = (0..120)
        .map(|i| TracePoint { progress: i as f32 / 120.0, elapsed_ms: i * 800, speed_kmh: 150.0, throttle: 1.0, brake: 0.0, clutch: 0.0, steering: 0.25, gear: 4 })
        .collect();
    let with_trace = CompletedLap { trace: Some(LapTrace(points)), ..lap(96_000, true) };
    let id = tt.record_lap(&with_trace).unwrap().lap.id;
    let back = tt.lap_trace(id).unwrap().expect("trace stored");
    assert_eq!((back.0.len(), back.0[10].gear), (120, 4));
    // Laps without one simply have none.
    let other = tt.record_lap(&lap(97_000, true)).unwrap().lap.id;
    assert!(tt.lap_trace(other).unwrap().is_none());
}

#[test]
fn challenge_replay_gives_each_drivers_best_lap_with_its_profile() {
    let tt = TimeTrial::in_memory().unwrap();
    let c = tt
        .create_challenge(&NewChallenge {
            name: "Hot lap".into(),
            game: "acevo".into(),
            track: "Imola".into(),
            layout: String::new(),
            car: None,
            starts_at: Some(0),
            ends_at: None,
            valid_only: true,
            max_laps: None,
            prizes: vec![],
        })
        .unwrap();
    tt.add_and_seat("Jess", None).unwrap();
    tt.record_lap(&profiled_lap(100_000)).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&lap(101_000, true)).unwrap(); // recorded without a trace
    let replay = tt.challenge_replay(c.id).unwrap();
    assert_eq!(replay.len(), 2);
    assert_eq!((replay[0].position, replay[0].time_ms), (1, 100_000));
    let p = replay[0].profile.as_ref().expect("profile");
    assert_eq!((p.len(), p[0], *p.last().unwrap()), (201, 0, 100_000));
    assert!(replay[1].profile.is_none());
}

#[test]
fn the_overlay_knows_whether_the_game_is_driving_paused_or_in_a_menu() {
    use tt_games::GamePhase;
    let tt = TimeTrial::in_memory().unwrap();
    assert_eq!(tt.overlay_show().unwrap(), "drivingPaused");
    assert!(tt.set_overlay_show("whenever").is_err());
    tt.set_overlay_show("driving").unwrap();
    assert_eq!(tt.overlay_show().unwrap(), "driving");
    assert_eq!(tt.status().unwrap().overlay_show, "driving");

    let mut rx = tt.subscribe();
    for phase in [GamePhase::Menu, GamePhase::Driving, GamePhase::Paused, GamePhase::Replay] {
        tt.handle_game_event(GameEvent::Live(tt_games::LiveState {
            driving: phase == GamePhase::Driving,
            phase,
            current_lap_ms: 0,
            lap_valid: true,
            out_lap: false,
            lap_progress: 0.0,
            position: None,
            inputs: None,
        }))
        .unwrap();
    }
    let seen: Vec<&str> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|e| if let AppEvent::Live { live } = e { Some(live.phase) } else { None })
        .collect();
    assert_eq!(seen, ["menu", "driving", "paused", "replay"]);
}

#[test]
fn a_drivers_laps_come_back_oldest_first_and_only_theirs() {
    let tt = TimeTrial::in_memory().unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    tt.record_lap_at(&lap(101_000, true), 1_000).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap_at(&lap(99_000, true), 2_000).unwrap();
    tt.set_seat(Some(jess.id)).unwrap();
    tt.record_lap_at(&lap(100_000, true), 3_000).unwrap();
    let laps = tt.driver_laps(jess.id).unwrap();
    assert_eq!(laps.iter().map(|l| l.time_ms).collect::<Vec<_>>(), [101_000, 100_000]);
}

#[test]
fn speed_scores_compare_drivers_only_on_what_they_share() {
    let tt = TimeTrial::in_memory().unwrap();
    let lap_on = |tt: &TimeTrial, track: &str, ms: u32| {
        let mut l = lap(ms, true);
        l.session.track = track.into();
        tt.record_lap(&l).unwrap();
    };
    let jess = tt.add_and_seat("Jess", None).unwrap();
    lap_on(&tt, "Imola", 100_000);
    lap_on(&tt, "Suzuka", 50_000);
    let sam = tt.add_and_seat("Sam", None).unwrap();
    lap_on(&tt, "Imola", 102_000); // 2% off Jess
    let kit = tt.add_and_seat("Kit", None).unwrap();
    lap_on(&tt, "Monza", 90_000); // nobody to compare with
    let new = tt.add_and_seat("Newbie", None).unwrap();

    let ratings = tt.driver_ratings().unwrap();
    let get = |id| ratings.iter().find(|r| r.driver_id == id).unwrap().clone();
    let (j, s) = (get(jess.id), get(sam.id));
    assert_eq!((j.score, j.combos, j.fastest_on), (Some(100.0), 1, 1));
    assert!((s.score.unwrap() - 98.0).abs() < 1e-9 && s.combos == 1 && s.fastest_on == 0);
    // Alone on their track, or no laps at all: not rated yet (never a free 100).
    assert_eq!(get(kit.id).score, None);
    assert_eq!(get(new.id).score, None);
}

fn driving(p: f32) -> GameEvent {
    GameEvent::Live(tt_games::LiveState {
        driving: true,
        phase: tt_games::GamePhase::Driving,
        current_lap_ms: (p * 100_000.0) as u32,
        lap_valid: true,
        out_lap: false,
        lap_progress: p,
        position: None,
        inputs: None,
    })
}

#[test]
fn swapping_drivers_mid_lap_voids_that_lap_for_everyone() {
    let tt = TimeTrial::in_memory().unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(driving(0.4)).unwrap();

    // Sam grabs the seat just before the line, hoping to take Jess's good lap.
    let mut rx = tt.subscribe();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.handle_game_event(driving(0.9)).unwrap();
    let live = std::iter::from_fn(|| rx.try_recv().ok()).find_map(|e| if let AppEvent::Live { live } = e { Some(live) } else { None }).unwrap();
    assert!(!live.lap_valid);
    assert_eq!(live.void_reason, Some("driverChange"));

    tt.handle_game_event(GameEvent::LapCompleted(lap(80_000, true))).unwrap();
    let laps = tt.recent_laps(5).unwrap();
    assert_eq!((laps[0].valid, laps[0].untimed_reason.as_deref()), (false, Some("driverChange")));
    // It never reaches a leaderboard or a personal best, whoever it was recorded against.
    assert!(tt.leaderboard(&LeaderboardQuery { include_invalid: true, ..imola_board() }).unwrap().is_empty());
    assert_eq!(tt.driver_ratings().unwrap().iter().filter(|r| r.score.is_some()).count(), 0);

    // The next lap is clean again: it counts for whoever is driving it.
    tt.handle_game_event(driving(0.1)).unwrap();
    let mut rx = tt.subscribe();
    tt.handle_game_event(driving(0.2)).unwrap();
    let live = std::iter::from_fn(|| rx.try_recv().ok()).find_map(|e| if let AppEvent::Live { live } = e { Some(live) } else { None }).unwrap();
    assert!(live.lap_valid && live.void_reason.is_none());
    tt.handle_game_event(GameEvent::LapCompleted(lap(81_000, true))).unwrap();
    let board = tt.leaderboard(&imola_board()).unwrap();
    assert_eq!((board.len(), board[0].driver_id), (1, Some(sam.id)));
    let _ = jess;
}

#[test]
fn switching_back_does_not_undo_the_void_and_switching_off_track_costs_nothing() {
    let tt = TimeTrial::in_memory().unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();

    // Not in a session yet (menus, garage): changing driver is free.
    tt.set_seat(Some(sam.id)).unwrap();
    tt.set_seat(Some(jess.id)).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(driving(0.3)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(90_000, true))).unwrap();
    assert!(tt.recent_laps(1).unwrap()[0].valid, "no mid-lap swap happened");

    // Swap and swap back mid-lap: still voided, so nobody can sneak a change in and out.
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.set_seat(Some(jess.id)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(89_000, true))).unwrap();
    assert_eq!(tt.recent_laps(1).unwrap()[0].untimed_reason.as_deref(), Some("driverChange"));

    // Choosing the driver who is already in the seat changes nothing.
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.set_seat(Some(jess.id)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(91_000, true))).unwrap();
    assert!(tt.recent_laps(1).unwrap()[0].valid);
}

fn out_lap_at(p: f32) -> GameEvent {
    GameEvent::Live(tt_games::LiveState {
        driving: true,
        phase: tt_games::GamePhase::Driving,
        current_lap_ms: 0,
        lap_valid: true,
        out_lap: true,
        lap_progress: p,
        position: None,
        inputs: None,
    })
}

#[test]
fn a_handover_in_the_pits_does_not_spoil_the_first_flying_lap() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();

    // Out lap: Jess pits, Sam takes over and drives out. (AC EVO reports no result for the out lap.)
    tt.handle_game_event(out_lap_at(0.5)).unwrap();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.handle_game_event(out_lap_at(0.95)).unwrap();
    // He crosses the line: the flying lap begins.
    tt.handle_game_event(driving(0.02)).unwrap();
    tt.handle_game_event(driving(0.6)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(92_000, true))).unwrap();
    let first = &tt.recent_laps(1).unwrap()[0];
    assert_eq!((first.valid, first.driver_id), (true, Some(sam.id)));
}

#[test]
fn a_swap_mid_lap_still_voids_the_lap_when_its_result_arrives_after_the_line() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(driving(0.4)).unwrap();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap(); // over the line; the game hasn't published the time yet
    tt.handle_game_event(GameEvent::LapCompleted(lap(85_000, true))).unwrap();
    assert_eq!(tt.recent_laps(1).unwrap()[0].untimed_reason.as_deref(), Some("driverChange"));
    // The lap that has just begun is clean.
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(86_000, true))).unwrap();
    assert!(tt.recent_laps(1).unwrap()[0].valid);
}

#[test]
fn about_counts_describe_the_database() {
    let tt = TimeTrial::in_memory().unwrap();
    assert_eq!(tt.about_counts().unwrap().laps, 0);
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&lap(90_000, true)).unwrap();
    tt.record_lap(&untimed_lap(95_000, UntimedReason::OutLap)).unwrap();
    let c = tt.about_counts().unwrap();
    assert_eq!((c.drivers, c.laps, c.timed_laps, c.traced_laps, c.challenges), (1, 2, 1, 0, 0));
    assert!(c.schema_version >= 5);
}

#[test]
fn a_newer_database_is_refused_not_downgraded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tt.db");
    {
        let tt = TimeTrial::open(&path).unwrap();
        tt.add_and_seat("Sam", None).unwrap();
    }
    // Pretend a future TimeTrial has moved the data on to a format this version doesn't know.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
    }
    let err = TimeTrial::open(&path).err().expect("must refuse").to_string();
    assert!(err.contains("newer version of TimeTrial") && err.contains("99"), "{err}");
    // And it was left exactly as the newer version wrote it.
    let conn = rusqlite::Connection::open(&path).unwrap();
    let v: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
    assert_eq!(v, 99);
}

#[test]
fn the_database_remembers_which_version_made_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tt.db");
    let first = TimeTrial::open(&path).unwrap();
    let c = first.about_counts().unwrap();
    assert_eq!((c.created_with.as_deref(), c.previous_version.as_deref()), (Some(env!("CARGO_PKG_VERSION")), None));
    drop(first);
    // Pretend an earlier build had opened it last.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE settings SET value = '0.0.9' WHERE key = 'last_opened_with'", []).unwrap();
        conn.execute("UPDATE settings SET value = '0.0.1' WHERE key = 'created_with'", []).unwrap();
    }
    let again = TimeTrial::open(&path).unwrap();
    let c = again.about_counts().unwrap();
    assert_eq!((c.created_with.as_deref(), c.previous_version.as_deref()), (Some("0.0.1"), Some("0.0.9")));
}

/// A brand-new install (empty database, no game files, no user catalogue) still offers every bundled
/// track and car, all flagged as not driven yet.
#[test]
fn fresh_install_lists_the_bundled_catalogue() {
    let tt = TimeTrial::in_memory().unwrap();
    let cat = tt.catalogue("acevo").unwrap();
    assert!(cat.tracks.len() >= 10 && cat.cars.len() >= 40, "{} tracks, {} cars", cat.tracks.len(), cat.cars.len());
    assert!(cat.tracks.iter().all(|t| !t.seen) && cat.cars.iter().all(|c| !c.seen));
}
