//! Measures AC EVO's own frame rate (from its shared memory) while the Bin It
//! overlay is shown vs hidden, to quantify what the overlay costs.
//!
//!   cargo run -p tt-games --example acevo_fps -- [seconds-per-phase] [rounds]
//!
//! Keep the game in a steady state (same view, e.g. sitting still on track or paused)
//! while it runs. Bin It must be running (the overlay is toggled through its API).

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use std::io::Write;
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    use tt_games::acevo::Connection;

    let mut args = std::env::args().skip(1);
    let phase_secs: u64 = args.next().and_then(|a| a.parse().ok()).unwrap_or(15);
    let rounds: u32 = args.next().and_then(|a| a.parse().ok()).unwrap_or(2);

    fn set_overlay(visible: bool) -> anyhow::Result<()> {
        let body = format!("{{\"enabled\":{visible}}}");
        let mut s = TcpStream::connect("127.0.0.1:7878")?;
        write!(
            s,
            "PUT /api/overlay/visible HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )?;
        Ok(())
    }

    let conn = Connection::open_unchecked()?;
    let fps_now = || conn.read_graphics().player_stats[6];

    let mut results: Vec<(bool, f64)> = Vec::new();
    for round in 1..=rounds {
        for visible in [true, false] {
            set_overlay(visible)?;
            std::thread::sleep(Duration::from_secs(2)); // let it settle
            let start = Instant::now();
            let mut samples = Vec::new();
            while start.elapsed() < Duration::from_secs(phase_secs) {
                samples.push(fps_now() as f64);
                std::thread::sleep(Duration::from_millis(250));
            }
            let avg = samples.iter().sum::<f64>() / samples.len().max(1) as f64;
            println!("round {round} overlay {:>6}: {avg:6.1} fps", if visible { "shown" } else { "hidden" });
            results.push((visible, avg));
        }
    }
    set_overlay(true)?;

    let mean = |v: bool| {
        let xs: Vec<f64> = results.iter().filter(|r| r.0 == v).map(|r| r.1).collect();
        xs.iter().sum::<f64>() / xs.len() as f64
    };
    let (shown, hidden) = (mean(true), mean(false));
    println!(
        "\noverlay shown {shown:.1} fps, hidden {hidden:.1} fps -> cost {:.1} fps ({:.1}%)",
        hidden - shown,
        (hidden - shown) / hidden * 100.0
    );
    Ok(())
}

#[cfg(not(windows))]
fn main() {}
