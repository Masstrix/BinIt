//! Diagnostic tool: connects to a running Assetto Corsa and prints what it reads, so the memory layout
//! in `tt_games::ac::layout` can be checked against the real game.
//!
//!   cargo run -p tt-games --example ac_probe                  # watch for 20 seconds
//!   cargo run -p tt-games --example ac_probe -- --seconds 120 # watch longer (drive some laps)
//!   cargo run -p tt-games --example ac_probe -- --dump        # also save the raw pages to ./dumps

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use std::time::{Duration, Instant};

    use tt_games::ac::layout::{graphics, physics, statics};
    use tt_games::ac::{self, AcAdapter, Connection};
    use tt_games::{GameAdapter, GameEvent};

    let args: Vec<String> = std::env::args().collect();
    let dump = args.iter().any(|a| a == "--dump");
    let seconds: u64 = args.iter().position(|a| a == "--seconds").and_then(|i| args.get(i + 1)).and_then(|s| s.parse().ok()).unwrap_or(20);

    println!("{:?} running: {}", ac::PROCESS_NAMES, ac::is_running());
    let conn = Connection::open_unchecked()?;
    println!(
        "page sizes: physics {} (needs {}), graphics {} (needs {}), static {} (needs {})",
        conn.physics_bytes().len(),
        physics::NEEDED,
        conn.graphics_bytes().len(),
        graphics::NEEDED,
        conn.static_bytes().len(),
        statics::NEEDED,
    );

    let s = conn.read_static();
    println!(
        "static: sm_version={:?} ac_version={:?} car={:?} track={:?} layout={:?} length={:.0}m sectors={}",
        s.sm_version, s.ac_version, s.car_model, s.track, s.track_configuration, s.track_length_m, s.sector_count
    );

    if dump {
        std::fs::create_dir_all("dumps")?;
        std::fs::write("dumps/ac_physics.bin", conn.physics_bytes())?;
        std::fs::write("dumps/ac_graphics.bin", conn.graphics_bytes())?;
        std::fs::write("dumps/ac_static.bin", conn.static_bytes())?;
        println!("raw pages written to ./dumps");
    }

    let mut adapter = AcAdapter::new();
    let started = Instant::now();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    while started.elapsed() < Duration::from_secs(seconds) {
        for event in adapter.poll() {
            match event {
                GameEvent::Live(_) => {}
                other => println!(">>> {other:?}"),
            }
        }
        if last_print.elapsed() >= Duration::from_millis(500) {
            last_print = Instant::now();
            let g = conn.read_graphics();
            let p = conn.read_physics();
            println!(
                "status={} session={}({}) laps={} cur={}ms last={}ms best={}ms sector={} pit={}/{} pos={:.3} xyz=({:.0},{:.0},{:.0}) | gas={:.2} brake={:.2} clutch={:.2} steer={:.3} gear={} rpm={} {:.0}km/h out={}",
                g.status,
                g.session,
                ac::session_kind_name(g.session),
                g.completed_laps,
                g.current_time_ms,
                g.last_time_ms,
                g.best_time_ms,
                g.current_sector,
                g.in_pit as i32,
                g.in_pit_lane as i32,
                g.progress,
                g.position[0],
                g.position[1],
                g.position[2],
                p.gas,
                p.brake,
                p.clutch,
                p.steer_angle,
                p.gear,
                p.rpm,
                p.speed_kmh,
                p.tyres_out,
            );
        }
        std::thread::sleep(adapter.poll_interval());
    }
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Assetto Corsa's shared memory is only available on Windows.");
}
