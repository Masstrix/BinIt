//! Diagnostic tool: connects to a running AC EVO and prints what it reads.
//!
//!   cargo run -p tt-games --example acevo_probe            # watch fields + detected laps
//!   cargo run -p tt-games --example acevo_probe -- --dump  # also save raw pages to ./dumps

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use std::time::{Duration, Instant};
    use std::mem::offset_of;

    use tt_games::acevo::layout::{Graphics, Static, c_str};
    use tt_games::acevo::{self, AcEvoAdapter, Connection};
    use tt_games::{GameAdapter, GameEvent};

    let dump = std::env::args().any(|a| a == "--dump");

    println!("layout: graphics {} bytes, static {} bytes", size_of::<Graphics>(), size_of::<Static>());
    println!(
        "offsets: total_lap_count {}  last_laptime_ms {}  timing_state {}  car_model {}  is_valid_lap {}",
        offset_of!(Graphics, total_lap_count),
        offset_of!(Graphics, last_laptime_ms),
        offset_of!(Graphics, timing_state),
        offset_of!(Graphics, car_model),
        offset_of!(Graphics, is_valid_lap),
    );
    println!("{} running: {}", acevo::PROCESS_NAME, tt_games::is_process_running(acevo::PROCESS_NAME));

    let conn = Connection::open_unchecked()?;
    println!("graphics region: {} bytes", conn.graphics_region_size());

    let s = conn.read_static();
    println!(
        "static: sm_version={:?} game={:?} session={} ({}) name={:?} track={:?} layout={:?} length={:.0}m",
        c_str(&s.sm_version),
        c_str(&s.ac_evo_version),
        { s.session },
        acevo::session_kind_name(s.session),
        c_str(&s.session_name),
        c_str(&s.track),
        c_str(&s.track_configuration),
        { s.track_length_m },
    );

    if dump {
        std::fs::create_dir_all("dumps")?;
        std::fs::write("dumps/graphics.bin", conn.graphics_bytes())?;
        std::fs::write("dumps/static.bin", conn.static_bytes())?;
        println!("raw pages written to ./dumps");
    }

    let mut adapter = AcEvoAdapter::new();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    loop {
        for event in adapter.poll() {
            match event {
                GameEvent::Live(_) => {}
                other => println!(">>> {other:?}"),
            }
        }

        if last_print.elapsed() >= Duration::from_secs(1) {
            last_print = Instant::now();
            let g = conn.read_graphics();
            let t = g.timing_state;
            println!(
                "pkt={} status={} laps={} cur={}ms last={}ms best={}ms valid={} ts_invalid={} pit={}/{} npos={:.3} car={:?} | hud cur={:?} last={:?} best={:?} | driver={:?} {:?}",
                { g.packet_id },
                { g.status },
                { g.total_lap_count },
                { g.current_lap_time_ms },
                { g.last_laptime_ms },
                { g.best_laptime_ms },
                g.is_valid_lap,
                t.is_invalid,
                g.is_in_pit_lane,
                g.is_in_pit_box,
                { g.npos },
                c_str(&g.car_model),
                c_str(&t.current_laptime),
                c_str(&t.last_laptime),
                c_str(&t.best_laptime),
                c_str(&g.driver_name),
                c_str(&g.driver_surname),
            );
        }

        std::thread::sleep(adapter.poll_interval());
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("AC EVO telemetry is only available on Windows.");
}
