use super::*;
use tt_games::{CompletedLap, GameId, SessionInfo, UntimedReason};

fn session(car: &str) -> SessionInfo {
    SessionInfo {
        game: GameId::AssettoCorsaEvo,
        track: "imola".into(),
        layout: None,
        car: car.into(),
        session_kind: "Hot Stint".into(),
        timing: tt_games::TimingKind::CircuitLap,
        length_m: Some(4909),
    }
}

fn lap(time_ms: u32, valid: bool) -> CompletedLap {
    let untimed = (!valid).then_some(UntimedReason::Cut);
    CompletedLap { session: session("porsche_992_gt3_r"), lap_number: 1, time_ms, valid, untimed, sectors_ms: vec![], profile: None }
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
    LeaderboardQuery { game: "acevo".into(), track: "imola".into(), ..Default::default() }
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
            track: "imola".into(),
            layout: String::new(),
            car: Some("porsche_992_gt3_r".into()),
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
    tt.handle_game_event(GameEvent::SessionChanged(session("porsche_992_gt3_r"))).unwrap();
    tt.handle_game_event(GameEvent::LapCompleted(lap(102_000, true))).unwrap();

    let status = tt.status().unwrap();
    assert!(status.connected);
    assert_eq!(status.session.unwrap().combo.track, "imola");

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
    tt.handle_game_event(GameEvent::SessionChanged(session("porsche_992_gt3_r"))).unwrap();
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
}

#[test]
fn live_timing_compares_against_the_seated_drivers_pb() {
    let tt = TimeTrial::in_memory().unwrap();
    tt.handle_game_event(GameEvent::SessionChanged(session("porsche_992_gt3_r"))).unwrap();
    tt.add_and_seat("Sam", None).unwrap();
    tt.record_lap(&profiled_lap(100_000)).unwrap();

    let mut rx = tt.subscribe();
    let live = |p: f32, t: u32| GameEvent::Live(tt_games::LiveState { driving: true, current_lap_ms: t, lap_valid: true, out_lap: false, lap_progress: p });
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
