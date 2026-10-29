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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
    let a = tt.add_driver("Sam", None).unwrap();
    let b = tt.add_driver("  sam ", None).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(tt.drivers().unwrap().len(), 1);
}

#[test]
fn laps_go_to_whoever_is_in_the_seat() {
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
    let challenge = tt
        .create_challenge(&NewChallenge { reward_size: None,
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
fn a_challenge_position_counts_a_lap_from_the_same_millisecond() {
    // A fast PC can record two laps in one millisecond: the earlier one still counts as "before".
    let tt = BinIt::in_memory().unwrap();
    tt.create_challenge(&NewChallenge { reward_size: None,
        name: "Imola".into(),
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
    tt.add_and_seat("Sam", None).unwrap();
    let first = tt.record_lap_at(&lap(103_000, true), 5_000).unwrap();
    assert_eq!(first.challenges[0].position, Some(1));
    let second = tt.record_lap_at(&lap(101_900, true), 5_000).unwrap();
    assert_eq!(second.challenges[0].previous_position, Some(1));
    assert_eq!(second.challenges[0].position, Some(1));
}

#[test]
fn game_events_drive_session_and_laps() {
    let tt = BinIt::in_memory().unwrap();
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
        let tt = BinIt::open(&path).unwrap();
        tt.add_and_seat("Sam", Some("#ff9f6b")).unwrap();
        tt.record_lap(&lap(102_318, true)).unwrap();
    }
    let tt = BinIt::open(&path).unwrap();
    assert_eq!(tt.drivers().unwrap()[0].color, "#FF9F6B");
    assert!(tt.seat().unwrap().is_some());
    assert_eq!(tt.recent_laps(10).unwrap().len(), 1);
}

#[test]
fn another_database_merges_in_by_driver_name_and_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("timetrial.db");
    {
        let old = BinIt::open(&old_path).unwrap();
        old.add_and_seat("Jess", None).unwrap();
        old.record_lap(&lap(102_114, true)).unwrap();
        old.add_and_seat("Sam", None).unwrap();
        old.record_lap(&lap(103_000, true)).unwrap();
        old.record_lap(&lap(101_500, true)).unwrap();
        old.set_seat(None).unwrap();
        old.record_lap(&lap(104_000, true)).unwrap(); // a guest lap
        old.create_challenge(&NewChallenge { reward_size: None,
            name: "Imola Week".into(),
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
        old.set_seat(Some(old.drivers().unwrap()[0].id)).unwrap();
        old.set_setting("lan_enabled", Some("0")).unwrap();
        old.set_setting("overlay_layout:acevo", Some("{}")).unwrap();
    }

    let tt = BinIt::in_memory().unwrap();
    tt.add_driver("Taylor", None).unwrap();
    let sam = tt.add_and_seat("sam", None).unwrap(); // the same Sam, already here
    tt.record_lap(&lap(100_900, true)).unwrap();
    tt.set_setting("lan_enabled", Some("1")).unwrap();

    let report = tt.merge_from(&old_path).unwrap();
    assert_eq!(report, MergeReport { drivers: 1, laps: 4, challenges: 1 });

    let mut names: Vec<_> = tt.drivers().unwrap().into_iter().map(|d| d.name).collect();
    names.sort();
    assert_eq!(names, ["Jess", "Taylor", "sam"]);
    let jess = tt.drivers().unwrap().into_iter().find(|d| d.name == "Jess").unwrap();
    // Sam's old laps join the Sam already here (oldest first); the guest lap stays a guest lap.
    assert_eq!(tt.driver_laps(sam.id).unwrap().iter().map(|l| l.time_ms).collect::<Vec<_>>(), [103_000, 101_500, 100_900]);
    assert_eq!(tt.driver_laps(jess.id).unwrap().len(), 1);
    assert_eq!(tt.recent_laps(10).unwrap().iter().filter(|l| l.driver_id.is_none()).count(), 1);
    let board = tt.leaderboard(&imola_board()).unwrap();
    assert_eq!(board.iter().map(|e| (e.driver_id, e.time_ms)).collect::<Vec<_>>(), [(Some(sam.id), 100_900), (Some(jess.id), 102_114), (None, 104_000)]);
    assert_eq!(tt.challenges().unwrap().len(), 1);

    // Bin It's own settings and seat win; what it didn't have comes over.
    assert_eq!(tt.setting("lan_enabled").unwrap().as_deref(), Some("1"));
    assert_eq!(tt.setting("overlay_layout:acevo").unwrap().as_deref(), Some("{}"));
    assert_eq!(tt.seat().unwrap(), Some(sam.id));

    // Merging the same data again adds nothing.
    assert_eq!(tt.merge_from(&old_path).unwrap(), MergeReport::default());
    assert_eq!(tt.recent_laps(10).unwrap().len(), 5);
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let drive = |tt: &BinIt, radius: f32| {
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
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let mut rx = tt.subscribe();
    let mut tr = LapTracker::default();
    let mut out = Vec::new();
    let mut lap_count = 0;
    let mut last_lap = 0;
    // Each lap a little different, as real ones are (an unchanged "last lap" is waited on).
    let lap_ms = |n: u32| 100_000i32 - n as i32 * 137;
    // (start progress, in pit lane at start) for the out lap, then full laps.
    let mut step = 0u32;
    let mut run = |tt: &BinIt, tr: &mut LapTracker, lap_ms: i32, start: f32, lap_label: String, lap_count: &mut i32, last_lap: &mut i32, counted: bool, from_pits: bool, out: &mut Vec<(String, bool, bool, Option<i32>, usize)>| {
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
    run(&tt, &mut tr, lap_ms(0), 0.5, "out".into(), &mut lap_count, &mut last_lap, counted_out_lap, true, &mut out);
    for n in 1..=laps_after_out {
        run(&tt, &mut tr, lap_ms(n), 0.0, format!("lap{n}"), &mut lap_count, &mut last_lap, true, false, &mut out);
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
    let tt = BinIt::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.store().set_track_map("acevo", "Imola", "", &[[0.0, 0.0], [1.0, 1.0]], true, 1).unwrap();
    assert!(tt.set_map_view("acevo", "Imola", "", 45, false).is_err());
    tt.set_map_view("acevo", "Imola", "", 90, true).unwrap();
    let m = &tt.track_maps("acevo").unwrap()[0];
    assert_eq!((m.rotate, m.mirror), (90, true));
}

#[test]
fn spellings_converge_and_old_data_is_migrated_to_catalogue_names() {
    let tt = BinIt::in_memory().unwrap();
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
        .create_challenge(&NewChallenge { reward_size: None,
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let points = (0..120)
        .map(|i| TracePoint { progress: i as f32 / 120.0, elapsed_ms: i * 800, speed_kmh: 150.0, throttle: 1.0, brake: 0.0, clutch: 0.0, steering: 0.25, gear: 4, ..Default::default() })
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
    let tt = BinIt::in_memory().unwrap();
    let c = tt
        .create_challenge(&NewChallenge { reward_size: None,
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
    let lap_on = |tt: &BinIt, track: &str, ms: u32| {
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
fn a_result_that_arrives_before_the_line_is_seen_still_voids_the_right_lap() {
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    // A clean lap whose result comes in just before the readings show the car over the line.
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(90_000, true))).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap();
    assert!(tt.recent_laps(1).unwrap()[0].valid);
    // Sam takes over mid-lap: that lap is voided, the one after it is not.
    tt.handle_game_event(driving(0.4)).unwrap();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(101_000, true))).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap();
    assert_eq!(tt.recent_laps(1).unwrap()[0].untimed_reason.as_deref(), Some("driverChange"));
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(87_000, true))).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap();
    let next = &tt.recent_laps(1).unwrap()[0];
    assert_eq!((next.valid, next.driver_id), (true, Some(sam.id)));
}

#[test]
fn a_void_never_rolls_onto_the_next_lap_when_the_voided_lap_reports_nothing() {
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(driving(0.4)).unwrap();
    tt.set_seat(Some(sam.id)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap(); // over the line, but the game never publishes that lap
    tt.handle_game_event(driving(0.6)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(88_000, true))).unwrap();
    let next = &tt.recent_laps(1).unwrap()[0];
    assert_eq!((next.valid, next.untimed_reason.as_deref(), next.driver_id), (true, None, Some(sam.id)));
}

#[test]
fn a_swap_just_after_the_line_leaves_both_laps_alone() {
    let tt = BinIt::in_memory().unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.handle_game_event(driving(0.97)).unwrap();
    tt.handle_game_event(driving(0.01)).unwrap(); // over the line; the game hasn't published the time yet
    tt.set_seat(Some(sam.id)).unwrap(); // Sam takes over before it does
    tt.handle_game_event(GameEvent::LapCompleted(lap(90_000, true))).unwrap();
    let ended = &tt.recent_laps(1).unwrap()[0];
    assert_eq!((ended.valid, ended.driver_id), (true, Some(jess.id)), "Jess drove it, and nothing was swapped during it");
    // Sam has had the whole of the lap that began at the line.
    tt.handle_game_event(driving(0.5)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(87_000, true))).unwrap();
    let next = &tt.recent_laps(1).unwrap()[0];
    assert_eq!((next.valid, next.driver_id), (true, Some(sam.id)));
}

#[test]
fn a_swap_mid_lap_still_voids_the_lap_when_its_result_arrives_after_the_line() {
    let tt = BinIt::in_memory().unwrap();
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
    let tt = BinIt::in_memory().unwrap();
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
        let tt = BinIt::open(&path).unwrap();
        tt.add_and_seat("Sam", None).unwrap();
    }
    // Pretend a future Bin It has moved the data on to a format this version doesn't know.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
    }
    let err = BinIt::open(&path).err().expect("must refuse").to_string();
    assert!(err.contains("newer version of Bin It") && err.contains("99"), "{err}");
    // And it was left exactly as the newer version wrote it.
    let conn = rusqlite::Connection::open(&path).unwrap();
    let v: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
    assert_eq!(v, 99);
}

#[test]
fn the_database_remembers_which_version_made_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tt.db");
    let first = BinIt::open(&path).unwrap();
    let c = first.about_counts().unwrap();
    assert_eq!((c.created_with.as_deref(), c.previous_version.as_deref()), (Some(env!("CARGO_PKG_VERSION")), None));
    drop(first);
    // Pretend an earlier build had opened it last.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE settings SET value = '0.0.9' WHERE key = 'last_opened_with'", []).unwrap();
        conn.execute("UPDATE settings SET value = '0.0.1' WHERE key = 'created_with'", []).unwrap();
    }
    let again = BinIt::open(&path).unwrap();
    let c = again.about_counts().unwrap();
    assert_eq!((c.created_with.as_deref(), c.previous_version.as_deref()), (Some("0.0.1"), Some("0.0.9")));
}

/// A brand-new install (empty database, no game files, no user catalogue) still offers every bundled
/// track and car, all flagged as not driven yet.
#[test]
fn fresh_install_lists_the_bundled_catalogue() {
    let tt = BinIt::in_memory().unwrap();
    let cat = tt.catalogue("acevo").unwrap();
    assert!(cat.tracks.len() >= 10 && cat.cars.len() >= 40, "{} tracks, {} cars", cat.tracks.len(), cat.cars.len());
    assert!(cat.tracks.iter().all(|t| !t.seen) && cat.cars.iter().all(|c| !c.seen));
}

/// Two games that happen to use identical track, layout and car names must stay completely apart:
/// laps, leaderboards, ratings, learned maps, sector layouts, renames, deletes and the catalogue.
#[test]
fn games_with_identical_names_never_mix() {
    let tt = BinIt::in_memory().unwrap();
    let ann = tt.add_driver("Ann", None).unwrap();
    let bob = tt.add_driver("Bob", None).unwrap();
    let lap_in = |game: &str, track: &str, who: DriverId, ms: u32| Lap {
        id: 0,
        driver_id: Some(who),
        combo: Combo { game: game.into(), track: track.into(), layout: "GP".into(), car: "Same Car".into() },
        session_kind: "Hot Stint".into(),
        lap_number: 1,
        time_ms: ms,
        valid: true,
        untimed_reason: None,
        sectors_ms: vec![],
        recorded_at: 1_000,
    };
    {
        let store = tt.store();
        // acevo: Ann and Bob both drive Imola. dr2: only Ann does, faster, plus a track only dr2 has seen.
        for lap in [
            lap_in("acevo", "Imola", ann.id, 100_000),
            lap_in("acevo", "Imola", bob.id, 101_000),
            lap_in("dr2", "Imola", ann.id, 90_000),
            lap_in("dr2", "Zzz Test Track", ann.id, 80_000),
        ] {
            store.insert_lap(&lap, None, None).unwrap();
        }
        store.set_track_map("acevo", "Imola", "GP", &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]], true, 1).unwrap();
        store.set_sector_layout("acevo", "Imola", "GP", &[0.0, 0.5, 1.0], "even").unwrap();
    }
    let board = |game: &str| {
        tt.leaderboard(&LeaderboardQuery { game: game.into(), track: "Imola".into(), layout: "GP".into(), ..Default::default() })
            .unwrap()
            .iter()
            .map(|e| e.time_ms)
            .collect::<Vec<_>>()
    };
    // Leaderboards and combos.
    assert_eq!(board("acevo"), vec![100_000, 101_000]);
    assert_eq!(board("dr2"), vec![90_000]);
    assert!(board("acr").is_empty(), "a game with no laps has an empty board");
    assert!(tt.combos(Some("acevo")).unwrap().iter().all(|c| c.game == "acevo"));
    assert_eq!(tt.combos(None).unwrap().len(), 3);

    // Ratings only compare like with like: Ann's dr2 lap (no one to race there) doesn't count.
    let ratings = tt.driver_ratings().unwrap();
    let ann_rating = ratings.iter().find(|r| r.driver_id == ann.id).unwrap();
    assert_eq!((ann_rating.combos, ann_rating.fastest_on), (1, 1));

    // Learned maps and sector layouts belong to one game.
    assert_eq!(tt.track_maps("acevo").unwrap().len(), 1);
    assert!(tt.track_maps("dr2").unwrap().is_empty());
    assert!(tt.sector_boundaries("acevo", "Imola", "GP").unwrap().is_some());
    assert!(tt.sector_boundaries("dr2", "Imola", "GP").unwrap().is_none());

    // The catalogue lists what was driven in that game only.
    let has = |game: &str, track: &str| tt.catalogue(game).unwrap().tracks.iter().any(|t| t.name == track && t.seen);
    assert!(has("dr2", "Zzz Test Track"));
    assert!(!has("acevo", "Zzz Test Track"));

    // Renaming a track or deleting laps in one game leaves the other alone.
    tt.store().rename_track("acevo", "Imola", "Autodromo Imola").unwrap();
    assert_eq!(board("dr2"), vec![90_000]);
    let removed = tt
        .delete_laps(&LapFilter { game: "dr2".into(), track: "Imola".into(), layout: None, car: None, forget_map: true })
        .unwrap();
    assert_eq!(removed, 1);
    assert_eq!(tt.track_maps("acevo").unwrap().len(), 1, "forgetting a dr2 track must not drop an acevo map");
    assert_eq!(
        tt.leaderboard(&LeaderboardQuery { game: "acevo".into(), track: "Autodromo Imola".into(), layout: "GP".into(), ..Default::default() }).unwrap().len(),
        2
    );
}

// ---- paired phones ------------------------------------------------------------------------

#[test]
fn the_first_phone_claims_a_driver_and_is_recognised_afterwards() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    assert!(!tt.driver_is_claimed(sam.id).unwrap());

    let (token, driver) = tt.pair_device(sam.id, false, "iPhone").unwrap();
    assert_eq!(driver.id, sam.id);
    assert!(tt.driver_is_claimed(sam.id).unwrap());

    let (device, who) = tt.device_for_token(&token).unwrap().expect("the phone is known");
    assert_eq!((who.id, device.label.as_str()), (sam.id, "iPhone"));
    assert!(tt.device_for_token("not a token").unwrap().is_none());
}

#[test]
fn a_driver_signed_in_elsewhere_asks_are_you_sure_and_then_both_devices_stay_in() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    let (first, _) = tt.pair_device(sam.id, false, "iPhone").unwrap();

    let err = tt.pair_device(sam.id, false, "Laptop").unwrap_err();
    assert_eq!(err.downcast_ref::<pairing::PairError>(), Some(&pairing::PairError::AlreadySignedIn));
    assert_eq!(tt.devices().unwrap().iter().filter(|d| d.driver_id == sam.id).count(), 1, "asking changes nothing");

    let (second, _) = tt.pair_device(sam.id, true, "Laptop").unwrap();
    assert_eq!(tt.devices().unwrap().iter().filter(|d| d.driver_id == sam.id).count(), 2);
    assert!(tt.device_for_token(&first).unwrap().is_some(), "the first device is still signed in");
    assert!(tt.device_for_token(&second).unwrap().is_some());
    // Confirming for a driver nobody is signed in as is fine too.
    let jess = tt.add_driver("Jess", None).unwrap();
    assert!(tt.pair_device(jess.id, true, "Pixel").is_ok());
}

#[test]
fn logging_out_forgets_the_phone_and_signing_everyone_out_frees_the_driver() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    let (token, _) = tt.pair_device(sam.id, false, "iPhone").unwrap();

    assert!(tt.unpair_token(&token).unwrap());
    assert!(tt.device_for_token(&token).unwrap().is_none());
    assert!(!tt.unpair_token(&token).unwrap(), "already logged out");
    assert!(!tt.driver_is_claimed(sam.id).unwrap());

    let (a, _) = tt.pair_device(sam.id, false, "iPhone").unwrap();
    tt.pair_device(sam.id, true, "Android").unwrap();
    assert_eq!(tt.remove_driver_devices(sam.id).unwrap(), 2);
    assert!(tt.device_for_token(&a).unwrap().is_none());
    // Free again: the next phone to ask claims the driver without being asked.
    assert!(tt.pair_device(sam.id, false, "New phone").is_ok());
}

// ---- XP, coins and the profile ----------------------------------------------------------------

/// What a lap paid for the lap itself, leaving out the stickers it also unlocked.
fn lap_pay(a: &Awards) -> (i64, i64) {
    (a.xp - a.stickers.iter().map(|s| s.xp).sum::<i64>(), a.coins - a.stickers.iter().map(|s| s.coins).sum::<i64>())
}

#[test]
fn laps_earn_xp_and_coins_for_what_they_are() {
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();

    // First lap on a new track and car: the welcome bonus plus the lap itself.
    let first = tt.record_lap(&lap(103_000, true)).unwrap().awards;
    assert_eq!(lap_pay(&first), (progress::rewards().first_lap.xp + progress::rewards().clean_lap.xp, progress::rewards().first_lap.coins + progress::rewards().clean_lap.coins));
    // A slower lap is just a lap.
    let slower = tt.record_lap(&lap(104_000, true)).unwrap().awards;
    assert_eq!((slower.xp, slower.reasons.clone()), (progress::rewards().clean_lap.xp, vec!["Clean lap".to_string()]));
    assert!(slower.stickers.is_empty());
    // A personal best pays extra. Nobody else has driven here, so it is not a track record.
    let pb = tt.record_lap(&lap(102_000, true)).unwrap().awards;
    assert_eq!(lap_pay(&pb).0, progress::rewards().clean_lap.xp + progress::rewards().personal_best.xp);
    assert!(!pb.reasons.contains(&"Track record".to_string()));
    // Cut laps and out laps earn nothing.
    assert_eq!(tt.record_lap(&lap(101_000, false)).unwrap().awards, Awards::default());
    assert_eq!(tt.record_lap(&untimed_lap(95_000, UntimedReason::OutLap)).unwrap().awards, Awards::default());

    let p = tt.profile(tt.seat().unwrap().unwrap()).unwrap();
    assert_eq!(p.xp, first.xp + slower.xp + pb.xp);
    assert_eq!(p.coins, first.coins + slower.coins + pb.coins);
}

#[test]
fn a_track_record_needs_someone_else_to_beat_and_guests_earn_nothing() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&lap(103_000, true)).unwrap();
    let jess = tt.add_and_seat("Jess", None).unwrap();
    let beat = tt.record_lap(&lap(102_000, true)).unwrap().awards;
    assert!(beat.reasons.contains(&"Track record".to_string()), "{:?}", beat.reasons);
    assert_eq!(lap_pay(&beat).0, progress::rewards().first_lap.xp + progress::rewards().clean_lap.xp + progress::rewards().track_record.xp);

    tt.set_seat(None).unwrap();
    assert_eq!(tt.record_lap(&lap(99_000, true)).unwrap().awards, Awards::default());
    assert_eq!(tt.profile(jess.id).unwrap().xp, beat.xp);
    assert_eq!(tt.profile(sam.id).unwrap().bests[0].position, 2);
}

#[test]
fn crossing_a_level_is_reported_once_and_the_daily_cap_stops_lap_farming() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    let mut level_ups = Vec::new();
    let mut paid = 0;
    for i in 0..(progress::rewards().daily_lap_cap as u32 + 10) {
        let a = tt.record_lap(&lap(110_000 - i, true)).unwrap().awards;
        if let Some(l) = a.level_up {
            level_ups.push(l);
        }
        paid += a.reasons.iter().filter(|r| *r == "Clean lap").count();
    }
    assert!(level_ups.windows(2).all(|w| w[0] < w[1]) && level_ups.first() == Some(&2), "{level_ups:?}");
    assert_eq!(paid as i64, progress::rewards().daily_lap_cap, "plain laps stop paying after the cap");
    assert_eq!(tt.profile(sam.id).unwrap().level, *level_ups.last().unwrap());
}

#[test]
fn the_profile_counts_laps_streaks_and_stickers() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    let fresh = tt.profile(sam.id).unwrap();
    assert_eq!((fresh.level, fresh.xp, fresh.clean_percent, fresh.streak_days), (1, 0, 100, 0));
    assert!(fresh.stickers.iter().all(|s| !s.earned));

    for i in 0..9 {
        tt.record_lap(&lap(105_000 - i, true)).unwrap();
    }
    tt.record_lap(&lap(104_000, false)).unwrap();
    let p = tt.profile(sam.id).unwrap();
    assert_eq!((p.attempts, p.clean_laps, p.clean_percent, p.tracks), (10, 9, 90, 1));
    assert_eq!(p.streak_days, 1);
    let earned = |id: &str| p.stickers.iter().find(|s| s.id == id).unwrap().earned;
    assert!(earned("first-lap") && !earned("ten-clean") && !earned("clean-sweep"));
}

#[test]
fn streaks_count_back_from_today_or_yesterday() {
    let day = progress::DAY_MS;
    let now = 100 * day + 5_000;
    assert_eq!(streak_days([now].into_iter(), now), 1);
    assert_eq!(streak_days([now - day, now - 2 * day, now - 3 * day].into_iter(), now), 3, "yesterday still counts");
    assert_eq!(streak_days([now, now - 2 * day].into_iter(), now), 1, "a gap ends it");
    assert_eq!(streak_days([now - 3 * day].into_iter(), now), 0, "too long ago");
    assert_eq!(streak_days(std::iter::empty(), now), 0);
}

#[test]
fn laps_from_before_points_existed_are_paid_once() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_driver("Sam", None).unwrap();
    // Laps stored without going through the live path, as an older version would have left them.
    for (n, ms) in [(1, 104_000), (2, 103_000), (3, 105_000)] {
        let l = Lap {
            id: 0, driver_id: Some(sam.id), combo: combo_of(&session("Porsche 992 GT3 R")), session_kind: "Hot Stint".into(),
            lap_number: n, time_ms: ms, valid: true, untimed_reason: None, sectors_ms: vec![], recorded_at: 1_000 * i64::from(n),
        };
        tt.store().insert_lap(&l, None, None).unwrap();
    }
    tt.store().set_setting("points_backfilled_v1", None).unwrap();
    tt.store().backfill_points().unwrap();
    // First lap, a personal best, then a plain lap: three clean laps plus the first-lap and best bonuses.
    let rw = progress::rewards();
    let expected = rw.first_lap.xp + 3 * rw.clean_lap.xp + rw.personal_best.xp;
    assert_eq!(tt.profile(sam.id).unwrap().xp, expected);
    // Running it again changes nothing.
    tt.store().backfill_points().unwrap();
    assert_eq!(tt.profile(sam.id).unwrap().xp, expected);
}

// ---- Garage shop ---------------------------------------------------------------------------------

fn rich_driver(tt: &BinIt, coins: i64, xp: i64) -> DriverId {
    let d = tt.add_driver("Sam", None).unwrap();
    tt.store().insert_point_event(d.id, "lap", xp, coins, None, now_ms()).unwrap();
    d.id
}

#[test]
fn buying_spends_coins_once_and_unlocks_wearing_it() {
    let tt = BinIt::in_memory().unwrap();
    let id = rich_driver(&tt, 500, 600);
    let before = tt.shop(id).unwrap();
    assert_eq!((before.coins, before.level), (500, 4));

    // Not owned yet: cannot wear it.
    let aurora = Look { shell: Some("aurora".into()), ..Look::default() };
    assert!(tt.set_look(id, &aurora).is_err());

    let after = tt.buy(id, "shell", "aurora").unwrap();
    assert_eq!(after.coins, 500 - 320);
    assert_eq!(after.owned, vec!["shell:aurora".to_string()]);
    assert!(tt.buy(id, "shell", "aurora").is_err(), "cannot buy twice");

    let driver = tt.set_look(id, &aurora).unwrap();
    assert_eq!(driver.look.shell.as_deref(), Some("aurora"));
    // The look is what every screen sees through the driver list.
    assert_eq!(tt.drivers().unwrap()[0].look, driver.look);
    // The profile shows the spend in the ledger without touching XP.
    let p = tt.profile(id).unwrap();
    assert_eq!((p.xp, p.coins), (600, 180));
    assert_eq!(p.recent[0].kind, "buy:shell:aurora");
}

#[test]
fn the_shop_refuses_what_a_driver_cannot_afford_or_reach() {
    let tt = BinIt::in_memory().unwrap();
    let id = rich_driver(&tt, 100, 0);
    assert!(tt.buy(id, "shell", "sunset").is_err(), "150 coins needed");
    let id2 = rich_driver_named(&tt, "Jess", 5000, 0);
    assert!(tt.buy(id2, "shell", "holo").is_err(), "level 5 needed");
    assert!(tt.buy(id2, "decal", "bolt").is_err(), "free items are not sold");
    assert!(tt.buy(id2, "shell", "nope").is_err());
    assert_eq!(tt.shop(id2).unwrap().coins, 5000, "failed purchases cost nothing");
}

fn rich_driver_named(tt: &BinIt, name: &str, coins: i64, xp: i64) -> DriverId {
    let d = tt.add_driver(name, None).unwrap();
    tt.store().insert_point_event(d.id, "lap", xp, coins, None, now_ms()).unwrap();
    d.id
}

#[test]
fn a_look_is_checked_before_it_is_worn() {
    let tt = BinIt::in_memory().unwrap();
    let id = rich_driver(&tt, 0, 0);
    // Free items and any race number are fine; a decal defaults to the side.
    let ok = tt.set_look(id, &Look { decal: Some("flame".into()), stripe: Some("centre".into()), number: Some(7), ..Look::default() }).unwrap();
    assert_eq!(ok.look.decal_at.as_deref(), Some("side"));
    assert!(tt.set_look(id, &Look { number: Some(0), ..Look::default() }).is_err());
    assert!(tt.set_look(id, &Look { decal: Some("flame".into()), decal_at: Some("roof".into()), ..Look::default() }).is_err());
    assert!(tt.set_look(id, &Look { stripe: Some("made-up".into()), ..Look::default() }).is_err());
}

#[test]
fn a_database_from_before_the_garage_gains_looks_and_keeps_its_drivers() {
    let dir = std::env::temp_dir().join(format!("binit-garage-{}", now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("old.db");
    {
        let tt = BinIt::open(&path).unwrap();
        tt.add_driver("Sam", Some("#FF8A4C")).unwrap();
    }
    // Pretend it was saved before schema 10: no look column, no items table.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE drivers DROP COLUMN look; DROP TABLE driver_items; ALTER TABLE challenges DROP COLUMN reward_size; ALTER TABLE laps DROP COLUMN slides; PRAGMA user_version = 9;").unwrap();
    }
    let tt = BinIt::open(&path).unwrap();
    let sam = tt.drivers().unwrap().remove(0);
    assert_eq!((sam.name.as_str(), sam.look.clone()), ("Sam", Look::default()));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn default_eyes_are_a_shop_slot_with_free_starters() {
    let tt = BinIt::in_memory().unwrap();
    let id = rich_driver(&tt, 100, 0);
    // Chill, focus and happy are free; the cheeky face is sold.
    assert!(tt.set_look(id, &Look { face: Some("happy".into()), ..Look::default() }).is_ok());
    assert!(tt.set_look(id, &Look { face: Some("cheeky".into()), ..Look::default() }).is_err());
    tt.buy(id, "face", "cheeky").unwrap();
    let d = tt.set_look(id, &Look { face: Some("cheeky".into()), ..Look::default() }).unwrap();
    assert_eq!(d.look.face.as_deref(), Some("cheeky"));
    assert_eq!(tt.shop(id).unwrap().coins, 80);
}

#[test]
fn a_decal_can_be_painted_one_of_the_preset_colours() {
    let tt = BinIt::in_memory().unwrap();
    let id = rich_driver(&tt, 0, 0);
    let flame = |c: &str| Look { decal: Some("flame".into()), decal_color: Some(c.into()), ..Look::default() };
    assert_eq!(tt.set_look(id, &flame("#ff5d5d")).unwrap().look.decal_color.as_deref(), Some("#FF5D5D"));
    assert!(tt.set_look(id, &flame("#123456")).is_err());
    // No decal, no colour.
    let bare = tt.set_look(id, &Look { decal_color: Some("#FF5D5D".into()), ..Look::default() }).unwrap();
    assert_eq!(bare.look.decal_color, None);
}

// ---- Challenge rewards ----------------------------------------------------------------------------

fn entry(position: u32, driver: Option<DriverId>) -> LeaderboardEntry {
    LeaderboardEntry { position, driver_id: driver, lap_id: 0, time_ms: 100_000 + position * 1000, gap_ms: 0, car: String::new(), lap_count: 1, set_at: 0, sectors_ms: vec![], best_sectors_ms: vec![] }
}

#[test]
fn challenge_payouts_follow_placings_and_grow_with_the_field() {
    use crate::progress::{ChallengePay, Pay, challenge_payouts};
    let rules = ChallengePay {
        sizes: crate::progress::RewardSizes { low: 0.5, medium: 1.0, high: 2.0 },
        placings: vec![Pay { xp: 300, coins: 100 }, Pay { xp: 200, coins: 60 }],
        participation: Pay { xp: 20, coins: 5 },
        min_entrants: 2,
        scale_per_entrant: 0.5,
        max_scale: 2.0,
    };
    // Two drivers: base amounts. A guest lap is never paid and does not count as an entrant.
    let two = challenge_payouts(&rules, "Hot Lap", "medium", &[entry(1, Some(1)), entry(2, Some(2)), entry(3, None)]);
    assert_eq!(two, vec![(1, "challenge:1:Hot Lap".to_string(), 300, 100), (2, "challenge:2:Hot Lap".to_string(), 200, 60)]);
    // Three drivers: +50%, and the third just takes part.
    let three = challenge_payouts(&rules, "Hot Lap", "medium", &[entry(1, Some(1)), entry(2, Some(2)), entry(3, Some(3))]);
    assert_eq!((three[0].2, three[0].3), (450, 150));
    assert_eq!(three[2], (3, "challenge:entry:Hot Lap".to_string(), 30, 8));
    // A big field stops at the cap.
    let many: Vec<_> = (1..=9).map(|i| entry(i, Some(i64::from(i)))).collect();
    assert_eq!(challenge_payouts(&rules, "x", "medium", &many)[0].2, 600);
    // The size picked for the challenge multiplies the lot: low halves it, high doubles it (and the field's own cap still applies first).
    let board = [entry(1, Some(1)), entry(2, Some(2))];
    assert_eq!(challenge_payouts(&rules, "Hot Lap", "low", &board)[0].3, 50);
    assert_eq!(challenge_payouts(&rules, "Hot Lap", "high", &board)[0].3, 200);
    assert_eq!(challenge_payouts(&rules, "Hot Lap", "nonsense", &board)[0].3, 100, "an unknown size counts as medium");
    // Alone: nothing.
    assert!(challenge_payouts(&rules, "Hot Lap", "medium", &[entry(1, Some(1))]).is_empty());
}

#[test]
fn a_finished_challenge_pays_once_and_old_ones_are_left_alone() {
    let tt = BinIt::in_memory().unwrap();
    let ids: Vec<DriverId> = ["Sam", "Jess", "Kim"].iter().map(|n| tt.add_driver(n, None).unwrap().id).collect();
    let now = now_ms();
    let combo = combo_of(&session("Porsche 992 GT3 R"));
    let new = |name: &str, starts: Timestamp, ends: Timestamp| NewChallenge { reward_size: None,
        name: name.into(), game: combo.game.clone(), track: combo.track.clone(), layout: combo.layout.clone(), car: None,
        starts_at: Some(starts), ends_at: Some(ends), valid_only: true, max_laps: None, prizes: vec![],
    };
    // A contest that ended before rewards existed: marked, never paid.
    let old = tt.create_challenge(&new("Old", now - 9000, now - 8000)).unwrap();
    for (i, id) in ids.iter().enumerate() {
        tt.record_lap_for(&lap(100_000 + i as u32 * 1000, true), now - 8500, Some(Some(*id)), None).unwrap();
    }
    assert_eq!(tt.settle_challenges().unwrap(), 0, "the first run only marks what had already ended");
    assert_eq!(tt.profile(ids[0]).unwrap().recent.iter().filter(|e| e.kind.starts_with("challenge:")).count(), 0);
    let _ = old;

    // One that ends later is paid, once.
    tt.create_challenge(&new("Hot Lap", now - 5000, now - 1000)).unwrap();
    for (i, id) in ids.iter().enumerate() {
        tt.record_lap_for(&lap(100_000 + i as u32 * 1000, true), now - 3000, Some(Some(*id)), None).unwrap();
    }
    let before: Vec<i64> = ids.iter().map(|id| tt.profile(*id).unwrap().coins).collect();
    assert_eq!(tt.settle_challenges().unwrap(), 3);
    assert_eq!(tt.settle_challenges().unwrap(), 0, "never paid twice");
    let after: Vec<i64> = ids.iter().map(|id| tt.profile(*id).unwrap().coins).collect();
    let rules = &progress::rewards().challenge;
    let scale = rules.scale(3);
    assert_eq!(after[0] - before[0], (rules.placings[0].coins as f64 * scale).round() as i64);
    assert_eq!(after[2] - before[2], (rules.placings[2].coins as f64 * scale).round() as i64);
    assert!(tt.profile(ids[0]).unwrap().recent.iter().any(|e| e.kind == "challenge:1:Hot Lap"));
}

#[test]
fn a_challenge_remembers_its_reward_size_and_refuses_a_made_up_one() {
    let tt = BinIt::in_memory().unwrap();
    let combo = combo_of(&session("Porsche 992 GT3 R"));
    let new = |size: Option<&str>| NewChallenge {
        name: "Sized".into(), game: combo.game.clone(), track: combo.track.clone(), layout: combo.layout.clone(), car: None,
        starts_at: None, ends_at: None, valid_only: true, max_laps: None, prizes: vec![], reward_size: size.map(String::from),
    };
    assert_eq!(tt.create_challenge(&new(None)).unwrap().reward_size, "medium");
    assert_eq!(tt.create_challenge(&new(Some("high"))).unwrap().reward_size, "high");
    assert!(tt.create_challenge(&new(Some("enormous"))).is_err());
}

#[test]
fn a_reset_is_counted_but_a_pause_and_crossing_the_line_are_not() {
    let tt = BinIt::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let live = |phase: tt_games::GamePhase, p: f32, t: u32| {
        GameEvent::Live(tt_games::LiveState { driving: phase == tt_games::GamePhase::Driving, phase, current_lap_ms: t, lap_valid: true, out_lap: false, lap_progress: p, position: None, inputs: None })
    };
    let resets = |tt: &BinIt| tt.status().unwrap().live.expect("live").resets;
    use tt_games::GamePhase::{Driving, Paused};
    tt.handle_game_event(live(Driving, 0.60, 90_000)).unwrap();
    // Paused with the clock where it was: nothing happened.
    tt.handle_game_event(live(Paused, 0.60, 90_000)).unwrap();
    tt.handle_game_event(live(Driving, 0.61, 91_000)).unwrap();
    assert_eq!(resets(&tt), 0);
    // Crossing the line: progress wraps and the clock restarts, which is a new lap.
    tt.handle_game_event(live(Driving, 0.99, 150_000)).unwrap();
    tt.handle_game_event(live(Driving, 0.01, 800)).unwrap();
    assert_eq!(resets(&tt), 0);
    // A reset to the pits mid-lap: progress and the clock jump back.
    tt.handle_game_event(live(Driving, 0.65, 116_000)).unwrap();
    tt.handle_game_event(live(Paused, 0.10, 16_000)).unwrap();
    assert_eq!(resets(&tt), 1);
}

#[test]
fn a_car_sliding_sideways_shows_as_a_drift_and_a_spin_in_the_live_state() {
    use tt_games::dynamics::Dynamics;
    use tt_games::GamePhase::Driving;
    let tt = BinIt::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    let slipping = |deg: f32, progress: f32| {
        let inputs = tt_games::Inputs { speed_kmh: 90.0, dynamics: Some(Dynamics { slip_deg: deg, ..Dynamics::default() }), ..Default::default() };
        GameEvent::Live(tt_games::LiveState { driving: true, phase: Driving, current_lap_ms: 30_000, lap_valid: true, out_lap: false, lap_progress: progress, position: None, inputs: Some(inputs) })
    };
    let live = |tt: &BinIt| tt.status().unwrap().live.expect("live");
    tt.handle_game_event(slipping(2.0, 0.30)).unwrap();
    assert_eq!(live(&tt).slide, "none");
    tt.handle_game_event(slipping(24.0, 0.31)).unwrap();
    assert_eq!(live(&tt).slide, "drift");
    assert_eq!(live(&tt).slide_stats.drifts, 1);
    assert_eq!(live(&tt).slide_stats.peak_slip_deg, 24.0);
    tt.handle_game_event(slipping(110.0, 0.32)).unwrap();
    assert_eq!(live(&tt).slide, "spin");
    assert_eq!(live(&tt).slide_stats.spins, 1);
    // Crossing the line starts the lap's totals again.
    tt.handle_game_event(slipping(2.0, 0.99)).unwrap();
    tt.handle_game_event(slipping(2.0, 0.01)).unwrap();
    assert_eq!(live(&tt).slide_stats.spins, 0);
}

#[test]
fn a_lap_keeps_what_its_driver_drifted_and_spun_and_a_clean_lap_keeps_nothing() {
    use tt_games::dynamics::Dynamics;
    use tt_games::GamePhase::Driving;
    let tt = BinIt::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("Porsche 992 GT3 R"))).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let at = |progress: f32, slip: f32| {
        let inputs = tt_games::Inputs { speed_kmh: 90.0, dynamics: Some(Dynamics { slip_deg: slip, ..Dynamics::default() }), ..Default::default() };
        GameEvent::Live(tt_games::LiveState { driving: true, phase: Driving, current_lap_ms: 30_000, lap_valid: true, out_lap: false, lap_progress: progress, position: None, inputs: Some(inputs) })
    };
    // Lap one: a drift, then a spin, then across the line and the game publishes the lap.
    tt.handle_game_event(at(0.30, 2.0)).unwrap();
    tt.handle_game_event(at(0.40, 25.0)).unwrap();
    tt.handle_game_event(at(0.50, 120.0)).unwrap();
    tt.handle_game_event(at(0.99, 2.0)).unwrap();
    tt.handle_game_event(at(0.01, 2.0)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(96_000, true))).unwrap();
    let first = tt.recent_laps(1).unwrap().remove(0);
    let slides = tt.lap_slides(first.id).unwrap().expect("the lap had a drift and a spin");
    assert_eq!((slides.drifts, slides.spins), (1, 1));
    assert_eq!(slides.peak_slip_deg, 25.0);

    // Lap two: clean. Nothing from lap one carries over, and nothing is stored.
    tt.handle_game_event(at(0.30, 1.0)).unwrap();
    tt.handle_game_event(at(0.99, 1.0)).unwrap();
    tt.handle_game_event(at(0.01, 1.0)).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(97_000, true))).unwrap();
    let second = tt.recent_laps(1).unwrap().remove(0);
    assert_ne!(first.id, second.id);
    assert_eq!(tt.lap_slides(second.id).unwrap(), None);
}

#[test]
fn a_trace_with_the_cars_position_and_heading_comes_back_out_of_the_database() {
    use tt_games::timing::{LapTrace, TracePoint};
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    let points = (0..120)
        .map(|i| TracePoint {
            progress: i as f32 / 120.0,
            elapsed_ms: i * 800,
            speed_kmh: 150.0,
            throttle: 1.0,
            gear: 4,
            position: Some([i as f32 * 5.0, -(i as f32) * 2.0]),
            heading_deg: Some(i as f32),
            slip_deg: Some(-3.5),
            ..Default::default()
        })
        .collect();
    let id = tt.record_lap(&CompletedLap { trace: Some(LapTrace(points)), ..lap(96_000, true) }).unwrap().lap.id;
    let back = tt.lap_trace(id).unwrap().expect("a trace");
    assert_eq!(back.0.len(), 120);
    assert_eq!(back.0[10].position, Some([50.0, -20.0]));
    assert_eq!(back.0[10].slip_deg, Some(-3.5));
}

#[test]
fn a_database_from_before_slides_gains_the_column_and_keeps_its_laps() {
    let dir = std::env::temp_dir().join(format!("binit-slides-{}", now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("old.db");
    let id = {
        let tt = BinIt::open(&path).unwrap();
        tt.add_and_seat("Sam", None).unwrap();
        tt.record_lap(&lap(96_000, true)).unwrap().lap.id
    };
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE laps DROP COLUMN slides; PRAGMA user_version = 11;").unwrap();
    }
    let tt = BinIt::open(&path).unwrap();
    assert_eq!(tt.recent_laps(5).unwrap().len(), 1);
    assert_eq!(tt.lap_slides(id).unwrap(), None);
    let _ = std::fs::remove_dir_all(dir);
}


// ---- achievement stickers -------------------------------------------------------------------------

fn sticker_ids(a: &Awards) -> Vec<&str> {
    a.stickers.iter().map(|s| s.id.as_str()).collect()
}

#[test]
fn a_sticker_unlocks_once_pays_through_the_ledger_and_shows_in_the_book() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    let cat = stickers::catalogue();
    let first = cat.stickers.iter().find(|s| s.id == "first-lap").unwrap();

    let a = tt.record_lap(&lap(103_000, true)).unwrap().awards;
    assert_eq!(sticker_ids(&a), vec!["first-lap"]);
    assert!(a.reasons.contains(&"Sticker: First lap".to_string()), "{:?}", a.reasons);
    let pay = cat.pay(first);
    assert_eq!((a.stickers[0].xp, a.stickers[0].coins), (pay.xp, pay.coins));
    assert!(tt.profile(sam.id).unwrap().recent.iter().any(|e| e.kind == "sticker:first-lap" && e.coins == pay.coins));

    // The same sticker is never paid twice.
    assert!(tt.record_lap(&lap(104_000, true)).unwrap().awards.stickers.is_empty());
    let book = tt.sticker_book(sam.id).unwrap();
    assert_eq!((book.earned, book.total), (1, cat.stickers.len() as u32));
    let view = |id: &str| book.stickers.iter().find(|s| s.id == id).unwrap().clone();
    assert!(view("first-lap").earned && view("first-lap").earned_at.is_some());
    // Counting stickers show how far along they are; designed-but-not-detectable ones say so.
    assert_eq!(view("ten-laps").progress.map(|p| (p.cur, p.max)), Some((2, 10)));
    assert!(!view("sideways").detectable && view("sideways").progress.is_none());
}

#[test]
fn laps_that_do_not_count_and_guests_unlock_nothing() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    assert!(tt.record_lap(&lap(103_000, false)).unwrap().awards.stickers.is_empty());
    tt.set_seat(None).unwrap();
    assert!(tt.record_lap(&lap(103_000, true)).unwrap().awards.stickers.is_empty());
    assert_eq!(tt.sticker_book(sam.id).unwrap().earned, 0);
    assert!(tt.sticker_book(9_999).is_err());
}

#[test]
fn personal_best_and_track_record_stickers_need_the_moment_not_just_the_history() {
    let tt = BinIt::in_memory().unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    assert!(!sticker_ids(&tt.record_lap(&lap(103_000, true)).unwrap().awards).contains(&"personal-best"));
    assert!(sticker_ids(&tt.record_lap(&lap(102_000, true)).unwrap().awards).contains(&"personal-best"));
    tt.add_and_seat("Jess", None).unwrap();
    let ids = sticker_ids(&tt.record_lap(&lap(101_000, true)).unwrap().awards).into_iter().map(String::from).collect::<Vec<_>>();
    assert!(ids.contains(&"crown".to_string()), "{ids:?}");
}

#[test]
fn a_run_of_clean_laps_is_broken_by_a_cut_and_a_lucky_time_is_noticed() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    for i in 0..4 {
        tt.record_lap(&lap(110_000 - i, true)).unwrap();
    }
    tt.record_lap(&lap(105_000, false)).unwrap(); // a cut
    tt.record_lap(&lap(109_000, true)).unwrap();
    assert!(!tt.sticker_book(sam.id).unwrap().stickers.iter().find(|s| s.id == "five-clean").unwrap().earned, "the cut broke the run");
    for i in 0..4 {
        tt.record_lap(&lap(108_000 - i, true)).unwrap();
    }
    assert!(tt.sticker_book(sam.id).unwrap().stickers.iter().find(|s| s.id == "five-clean").unwrap().earned);

    let lucky = tt.record_lap(&lap(101_777, true)).unwrap().awards;
    assert!(sticker_ids(&lucky).contains(&"lucky-seven"), "{:?}", sticker_ids(&lucky));
    // A hidden sticker has no name in the book until it is earned.
    let other = tt.add_driver("Jess", None).unwrap();
    let hidden = tt.sticker_book(other.id).unwrap().stickers.into_iter().find(|s| s.id == "mirror-lap").unwrap();
    assert_eq!((hidden.name.as_str(), hidden.how.as_str()), ("Hidden sticker", "Hidden. Read it backwards."));
}

#[test]
fn a_reward_can_give_a_free_item_and_stickers_for_old_laps_arrive_quietly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("binit.db");
    let sam = {
        let tt = BinIt::open(&path).unwrap();
        let sam = tt.add_and_seat("Sam", None).unwrap();
        tt.add_and_seat("Jess", None).unwrap();
        tt.record_lap(&lap(103_000, true)).unwrap();
        tt.set_seat(Some(sam.id)).unwrap();
        // Sam beats Jess: the Crown sticker, whose reward includes a decal.
        let a = tt.record_lap(&lap(102_000, true)).unwrap().awards;
        let crown = a.stickers.iter().find(|s| s.id == "crown").expect("crown");
        assert_eq!(crown.item.as_deref(), Some("decal:crown"));
        assert!(tt.shop(sam.id).unwrap().owned.contains(&"decal:crown".to_string()));
        (sam.id, tt.profile(sam.id).unwrap().coins)
    };
    let (sam, coins_before) = sam;
    // Wipe the stickers and the flag, as a database from before stickers existed would look.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("DELETE FROM driver_stickers; DELETE FROM settings WHERE key = 'stickers_backfilled_v1'; PRAGMA user_version = 12;").unwrap();
    }
    let tt = BinIt::open(&path).unwrap();
    let book = tt.sticker_book(sam).unwrap();
    assert!(book.stickers.iter().find(|s| s.id == "first-lap").unwrap().earned, "old laps count");
    assert!(!book.stickers.iter().find(|s| s.id == "crown").unwrap().earned, "a one-off moment cannot be proven from history");
    assert_eq!(tt.profile(sam).unwrap().coins, coins_before, "old unlocks pay nothing new");
}

#[test]
fn a_driver_shows_up_to_three_earned_stickers_on_their_profile() {
    let tt = BinIt::in_memory().unwrap();
    let sam = tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&lap(103_000, true)).unwrap();
    tt.record_lap(&lap(102_000, true)).unwrap(); // first-lap and personal-best
    assert!(tt.sticker_book(sam.id).unwrap().pinned.is_empty());

    let book = tt.pin_stickers(sam.id, &["personal-best".into(), "first-lap".into()]).unwrap();
    assert_eq!(book.pinned, vec!["personal-best", "first-lap"], "order is kept");
    // Not earned, repeated, or too many are refused and leave the choice as it was.
    assert!(tt.pin_stickers(sam.id, &["crown".into()]).is_err());
    assert!(tt.pin_stickers(sam.id, &["first-lap".into(), "first-lap".into()]).is_err());
    assert!(tt.pin_stickers(sam.id, &["a".into(), "b".into(), "c".into(), "d".into()]).is_err());
    assert!(tt.pin_stickers(9_999, &[]).is_err());
    assert_eq!(tt.sticker_book(sam.id).unwrap().pinned, vec!["personal-best", "first-lap"]);
    assert!(tt.pin_stickers(sam.id, &[]).unwrap().pinned.is_empty());
}
