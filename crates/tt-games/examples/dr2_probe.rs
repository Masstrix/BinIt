//! Diagnostic tool: listens for DiRT Rally 2.0's UDP telemetry and prints what arrives, so the layout
//! the adapter assumes can be checked against the real game.
//!
//! The game sends to every `<udp ... port=".." extradata="3">` entry in
//! `Documents\My Games\DiRT Rally 2.0\hardwaresettings\hardware_settings_config.xml`.
//!
//!   cargo run -p tt-games --example dr2_probe                          # port 20790 (Bin It's own), 30 seconds
//!   cargo run -p tt-games --example dr2_probe -- --port 20777 --seconds 600
//!   cargo run -p tt-games --example dr2_probe -- --seconds 900 --raw dumps/dr2.bin   # record every packet
//!
//! `--raw` writes each packet as a u16 little-endian length followed by its bytes.

use std::io::Write;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

use tt_games::dr2::layout::Packet;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    let port: u16 = value("--port").and_then(|s| s.parse().ok()).unwrap_or(tt_games::dr2::config::FIRST_PORT);
    let seconds: u64 = value("--seconds").and_then(|s| s.parse().ok()).unwrap_or(30);
    let mut raw = value("--raw").map(std::fs::File::create).transpose()?;

    let socket = UdpSocket::bind(("127.0.0.1", port))?;
    socket.set_read_timeout(Some(Duration::from_millis(500)))?;
    println!("listening on 127.0.0.1:{port} for {seconds}s; start a stage in DiRT Rally 2.0");

    let started = Instant::now();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    let mut count = 0u64;
    let mut sizes: Vec<usize> = Vec::new();
    let mut buf = [0u8; 2048];
    while started.elapsed() < Duration::from_secs(seconds) {
        let n = match socket.recv_from(&mut buf) {
            Ok((n, _)) => n,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e.into()),
        };
        count += 1;
        if !sizes.contains(&n) {
            sizes.push(n);
            println!("new packet size: {n} bytes ({} floats)", n / 4);
        }
        if let Some(f) = raw.as_mut() {
            f.write_all(&(n as u16).to_le_bytes())?;
            f.write_all(&buf[..n])?;
        }
        if last_print.elapsed() >= Duration::from_millis(500) {
            last_print = Instant::now();
            match Packet::parse(&buf[..n]) {
                Some(p) => println!(
                    "#{count} session={:.2} stage={:.3} dist={:.1}/{:.1} progress={:.3} pos=({:.1},{:.1}) speed={:.1}m/s \
                     gas={:.2} steer={:.2} brake={:.2} clutch={:.2} gear={} rpm={:.0} splits={}{}",
                    p.session_s, p.stage_s, p.distance_m, p.length_m, p.progress, p.x, p.z, p.speed_ms, p.throttle, p.steering,
                    p.brake, p.clutch, p.gear, p.rpm, p.splits,
                    p.final_time_ms().map(|t| format!(" FINISHED {t} ms")).unwrap_or_default(),
                ),
                None => println!("#{count} {n} bytes: not the 66-float format"),
            }
        }
    }
    println!("{count} packets in {:.1}s", started.elapsed().as_secs_f32());
    Ok(())
}
