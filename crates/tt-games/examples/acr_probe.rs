//! Diagnostic tool: connects to a running Assetto Corsa Rally and prints what it reads, so the layout in
//! `tt_games::acr::layout` can be checked against the real game after an update.
//!
//!   cargo run -p tt-games --example acr_probe                         # watch for 20 seconds
//!   cargo run -p tt-games --example acr_probe -- --seconds 600        # drive a stage and watch it
//!   cargo run -p tt-games --example acr_probe -- --seconds 900 --csv stage.csv   # also record every reading

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use std::io::Write;
    use std::time::{Duration, Instant};

    use tt_games::acr::{self, AcrAdapter, Connection, layout::Static};
    use tt_games::{GameAdapter, GameEvent};

    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    let seconds: u64 = value("--seconds").and_then(|s| s.parse().ok()).unwrap_or(20);
    let mut csv = value("--csv").map(std::fs::File::create).transpose()?;

    println!("{} running: {}", acr::PROCESS_NAME, acr::is_running());
    let conn = Connection::open()?;
    if let Some(f) = csv.as_mut() {
        writeln!(f, "t_ms,packet,clock,distance_m,progress,x,z,stage,car,length_m,speed_kmh,gas,brake,gear,rpm")?;
    }

    let mut adapter = AcrAdapter::new();
    let started = Instant::now();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    let mut last_packet = -1;
    while started.elapsed() < Duration::from_secs(seconds) {
        for event in adapter.poll() {
            match event {
                GameEvent::Live(_) => {}
                other => println!(">>> {other:?}"),
            }
        }
        let g = conn.read_graphics();
        let p = conn.read_physics();
        let s: Static = conn.read_static();
        if let (Some(f), true) = (csv.as_mut(), g.packet_id != last_packet) {
            let [x, z] = acr::player_position(&g).unwrap_or([0.0, 0.0]);
            writeln!(
                f,
                "{},{},{},{:.1},{:.4},{:.1},{:.1},{},{},{:.0},{:.1},{:.2},{:.2},{},{}",
                started.elapsed().as_millis(),
                g.packet_id,
                g.clock_text,
                g.distance_m,
                acr::progress(&g, &s),
                x,
                z,
                s.stage,
                s.car,
                s.length_m,
                p.speed_kmh,
                p.gas,
                p.brake,
                p.gear,
                p.rpm
            )?;
        }
        last_packet = g.packet_id;
        if last_print.elapsed() >= Duration::from_millis(500) {
            last_print = Instant::now();
            println!(
                "clock={:>9} ({:?} ms)  dist={:>7.1} m  progress={:.3}  | stage={:?} car={:?} length={:.0} m ({}) | {:.0} km/h gear {} rpm {}",
                g.clock_text,
                g.clock_ms(),
                g.distance_m,
                acr::progress(&g, &s),
                s.stage,
                s.car,
                s.length_m,
                if s.length_m > 0.0 { acr::stage_variant(s.length_m) } else { "no length".into() },
                p.speed_kmh,
                acr::display_gear(p.gear),
                p.rpm,
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Assetto Corsa Rally's shared memory is only available on Windows.");
}
