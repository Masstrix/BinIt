//! Local HTTP + WebSocket server.
//!
//! The desktop window, the overlay and any browser on the office network all talk to
//! TimeTrial through this one API, so there's a single code path for the UI.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tower_http::cors::CorsLayer;
use tt_core::{ChallengeId, DriverId, LapFilter, LapId, LeaderboardQuery, NewChallenge, TimeTrial};

pub const PORT: u16 = 7878;
pub const LAN_SETTING: &str = "lan_enabled";

#[derive(Clone)]
struct Ctx {
    tt: Arc<TimeTrial>,
    app: AppHandle,
    lan: bool,
}

struct ApiError(anyhow::Error);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({ "error": self.0.to_string() }));
        (StatusCode::BAD_REQUEST, body).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

pub async fn serve(tt: Arc<TimeTrial>, app: AppHandle, lan: bool) -> anyhow::Result<()> {
    let ctx = Ctx { tt, app, lan };
    let api = Router::new()
        .route("/status", get(status))
        .route("/server", get(server_info))
        .route("/drivers", get(drivers).post(add_driver))
        .route("/drivers/ratings", get(driver_ratings))
        .route("/drivers/{id}", put(update_driver))
        .route("/drivers/{id}/laps", get(driver_laps))
        .route("/seat", put(set_seat))
        .route("/laps/recent", get(recent_laps))
        .route("/laps/{id}/claim", post(claim_lap))
        .route("/laps/{id}/trace", get(lap_trace))
        .route("/combos", get(combos))
        .route("/catalogue", get(catalogue))
        .route("/maps", get(track_maps))
        .route("/sectors", get(sector_boundaries))
        .route("/maps/view", put(set_map_view))
        .route("/admin/about", get(admin_about))
        .route("/admin/laps/count", post(admin_count_laps))
        .route("/admin/laps/delete", post(admin_delete_laps))
        .route("/leaderboard", post(leaderboard))
        .route("/challenges", get(challenges).post(create_challenge))
        .route("/challenges/{id}", axum::routing::delete(delete_challenge))
        .route("/challenges/{id}/leaderboard", get(challenge_leaderboard))
        .route("/challenges/{id}/end", post(end_challenge))
        .route("/challenges/{id}/replay", get(challenge_replay))
        .route("/settings/lan", put(set_lan))
        .route("/overlay/visible", put(set_overlay_visible))
        .route("/overlay/enabled", put(set_overlay_enabled))
        .route("/overlay/focus-only", put(set_overlay_focus_only))
        .route("/overlay/show", put(set_overlay_show))
        .route("/overlay/layout/{game}", get(overlay_layout).put(set_overlay_layout).delete(reset_overlay_layout))
        .route("/events", get(events));

    let router = Router::new()
        .nest("/api", api)
        .fallback(static_asset)
        .layer(CorsLayer::permissive())
        .with_state(ctx);

    let ip: IpAddr = if lan { [0, 0, 0, 0].into() } else { [127, 0, 0, 1].into() };
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(ip, PORT)).await?;
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

async fn status(State(c): State<Ctx>) -> ApiResult<tt_core::Status> {
    Ok(Json(c.tt.status()?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    port: u16,
    lan_enabled: bool,
    /// Addresses other devices on the network can open.
    urls: Vec<String>,
}

async fn server_info(State(c): State<Ctx>) -> ApiResult<ServerInfo> {
    let urls = if c.lan { lan_urls() } else { Vec::new() };
    Ok(Json(ServerInfo { port: PORT, lan_enabled: c.lan, urls }))
}

/// Addresses other devices can open, best first. The one the PC reaches the network through
/// (its default route) leads, so it's the one worth putting in a QR code. Virtual adapters
/// (Hyper-V, WSL, Docker, VMs, VPNs) and link-local addresses are left out: phones can't reach them.
fn lan_urls() -> Vec<String> {
    let primary = local_ip_address::local_ip().ok();
    let ifaces = local_ip_address::list_afinet_netifas().unwrap_or_default();
    rank_urls(primary, ifaces)
}

fn rank_urls(primary: Option<IpAddr>, ifaces: Vec<(String, IpAddr)>) -> Vec<String> {
    const VIRTUAL: [&str; 10] =
        ["vethernet", "wsl", "docker", "vmware", "virtualbox", "vbox", "hyper-v", "default switch", "bluetooth", "loopback"];
    let usable = |ip: &Ipv4Addr| ip.is_private() && !ip.is_link_local();
    let mut ips: Vec<Ipv4Addr> = Vec::new();
    // The default-route address first, even when its adapter has an unusual name.
    if let Some(IpAddr::V4(p)) = primary
        && usable(&p)
    {
        ips.push(p);
    }
    for (name, ip) in ifaces {
        let name = name.to_lowercase();
        if let IpAddr::V4(v4) = ip
            && usable(&v4)
            && !ips.contains(&v4)
            && !VIRTUAL.iter().any(|v| name.contains(v))
        {
            ips.push(v4);
        }
    }
    ips.into_iter().map(|ip| format!("http://{ip}:{PORT}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iface(name: &str, ip: [u8; 4]) -> (String, IpAddr) {
        (name.to_string(), IpAddr::V4(ip.into()))
    }

    #[test]
    fn qr_address_is_the_real_network_not_a_virtual_adapter() {
        let ifaces = vec![
            iface("vEthernet (Default Switch)", [192, 168, 240, 1]),
            iface("Ethernet 2", [192, 168, 0, 79]),
            iface("Wi-Fi", [169, 254, 89, 107]),
            iface("Loopback Pseudo-Interface 1", [127, 0, 0, 1]),
        ];
        assert_eq!(rank_urls(Some([192, 168, 0, 79].into()), ifaces.clone()), vec!["http://192.168.0.79:7878"]);
        // Without a default route, the non-virtual adapters still come out and virtual ones don't.
        assert_eq!(rank_urls(None, ifaces), vec!["http://192.168.0.79:7878"]);
    }

    #[test]
    fn default_route_address_leads() {
        let ifaces = vec![iface("Ethernet", [10, 0, 0, 5]), iface("Wi-Fi", [192, 168, 1, 20])];
        assert_eq!(rank_urls(Some([192, 168, 1, 20].into()), ifaces), vec!["http://192.168.1.20:7878", "http://10.0.0.5:7878"]);
    }
}

#[derive(Deserialize)]
struct SetLan {
    enabled: bool,
}

/// Takes effect the next time TimeTrial starts.
async fn set_lan(State(c): State<Ctx>, Json(body): Json<SetLan>) -> ApiResult<bool> {
    c.tt.set_setting(LAN_SETTING, Some(if body.enabled { "1" } else { "0" }))?;
    Ok(Json(body.enabled))
}

/// Show/hide the in-game overlay (used by the FPS benchmark and the LAN page).
async fn set_overlay_visible(State(c): State<Ctx>, Json(body): Json<SetLan>) -> ApiResult<bool> {
    let app = c.app.clone();
    let _ = c.app.run_on_main_thread(move || crate::overlay::set_visible(&app, body.enabled));
    Ok(Json(body.enabled))
}

/// The saved on/off setting for the in-game overlay.
async fn set_overlay_enabled(State(c): State<Ctx>, Json(body): Json<SetLan>) -> ApiResult<bool> {
    c.tt.set_overlay_enabled(body.enabled)?;
    apply_overlay_settings(&c)?;
    Ok(Json(body.enabled))
}

/// Only show the overlay while a supported game is the focused app.
async fn set_overlay_focus_only(State(c): State<Ctx>, Json(body): Json<SetLan>) -> ApiResult<bool> {
    c.tt.set_overlay_focus_only(body.enabled)?;
    apply_overlay_settings(&c)?;
    Ok(Json(body.enabled))
}

#[derive(Deserialize)]
struct SetShow {
    mode: String,
}

/// When the overlay's widgets are drawn: always, not in menus, or only while driving.
async fn set_overlay_show(State(c): State<Ctx>, Json(body): Json<SetShow>) -> ApiResult<String> {
    c.tt.set_overlay_show(&body.mode)?;
    Ok(Json(body.mode))
}

fn apply_overlay_settings(c: &Ctx) -> anyhow::Result<()> {
    let (enabled, focus_only) = (c.tt.overlay_enabled()?, c.tt.overlay_focus_only()?);
    let app = c.app.clone();
    c.app.run_on_main_thread(move || crate::overlay::apply_settings(&app, enabled, focus_only))?;
    Ok(())
}

async fn overlay_layout(State(c): State<Ctx>, Path(game): Path<String>) -> ApiResult<Option<serde_json::Value>> {
    Ok(Json(c.tt.overlay_layout(&game)?))
}

async fn set_overlay_layout(
    State(c): State<Ctx>,
    Path(game): Path<String>,
    Json(layout): Json<serde_json::Value>,
) -> ApiResult<()> {
    c.tt.set_overlay_layout(&game, Some(&layout))?;
    Ok(Json(()))
}

async fn reset_overlay_layout(State(c): State<Ctx>, Path(game): Path<String>) -> ApiResult<()> {
    c.tt.set_overlay_layout(&game, None)?;
    Ok(Json(()))
}

async fn drivers(State(c): State<Ctx>) -> ApiResult<Vec<tt_core::Driver>> {
    Ok(Json(c.tt.drivers()?))
}

#[derive(Deserialize)]
struct AddDriver {
    name: String,
    color: Option<String>,
    /// Put the new driver straight in the seat.
    #[serde(default)]
    seat: bool,
}

async fn add_driver(State(c): State<Ctx>, Json(body): Json<AddDriver>) -> ApiResult<tt_core::Driver> {
    let driver = if body.seat {
        c.tt.add_and_seat(&body.name, body.color.as_deref())?
    } else {
        c.tt.add_driver(&body.name, body.color.as_deref())?
    };
    Ok(Json(driver))
}

#[derive(Deserialize)]
struct UpdateDriver {
    name: String,
    color: String,
}

async fn update_driver(
    State(c): State<Ctx>,
    Path(id): Path<DriverId>,
    Json(body): Json<UpdateDriver>,
) -> ApiResult<tt_core::Driver> {
    Ok(Json(c.tt.update_driver(id, &body.name, &body.color)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSeat {
    driver_id: Option<DriverId>,
}

async fn driver_ratings(State(c): State<Ctx>) -> ApiResult<Vec<tt_core::DriverRating>> {
    Ok(Json(c.tt.driver_ratings()?))
}

async fn driver_laps(State(c): State<Ctx>, Path(id): Path<DriverId>) -> ApiResult<Vec<tt_core::Lap>> {
    Ok(Json(c.tt.driver_laps(id)?))
}

async fn set_seat(State(c): State<Ctx>, Json(body): Json<SetSeat>) -> ApiResult<Option<DriverId>> {
    c.tt.set_seat(body.driver_id)?;
    Ok(Json(body.driver_id))
}

#[derive(Deserialize)]
struct Limit {
    limit: Option<u32>,
}

async fn recent_laps(State(c): State<Ctx>, Query(q): Query<Limit>) -> ApiResult<Vec<tt_core::Lap>> {
    Ok(Json(c.tt.recent_laps(q.limit.unwrap_or(20).min(200))?))
}

/// A lap's driver inputs as rows of `[progress, elapsedMs, speedKmh, throttle, brake, clutch, steering, gear]`
/// (rounded for size), or `null` when the lap has none.
async fn lap_trace(State(c): State<Ctx>, Path(id): Path<LapId>) -> ApiResult<Option<serde_json::Value>> {
    let round = |v: f32, d: f32| (v * d).round() / d;
    Ok(Json(c.tt.lap_trace(id)?.map(|t| {
        let rows: Vec<serde_json::Value> = t
            .0
            .iter()
            .map(|p| serde_json::json!([round(p.progress, 10000.0), p.elapsed_ms, round(p.speed_kmh, 10.0), round(p.throttle, 100.0), round(p.brake, 100.0), round(p.clutch, 100.0), round(p.steering, 100.0), p.gear]))
            .collect();
        serde_json::json!({ "lapId": id, "points": rows })
    })))
}

async fn claim_lap(State(c): State<Ctx>, Path(id): Path<LapId>, Json(body): Json<SetSeat>) -> ApiResult<()> {
    c.tt.claim_lap(id, body.driver_id)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
struct GameFilter {
    game: Option<String>,
}

async fn combos(State(c): State<Ctx>, Query(q): Query<GameFilter>) -> ApiResult<Vec<tt_core::Combo>> {
    Ok(Json(c.tt.combos(q.game.as_deref())?))
}

async fn catalogue(State(c): State<Ctx>, Query(q): Query<GameFilter>) -> ApiResult<tt_core::catalogue::Catalogue> {
    Ok(Json(c.tt.catalogue(q.game.as_deref().unwrap_or("acevo"))?))
}

async fn track_maps(State(c): State<Ctx>, Query(q): Query<GameFilter>) -> ApiResult<Vec<tt_core::trackmap::TrackMap>> {
    Ok(Json(c.tt.track_maps(q.game.as_deref().unwrap_or("acevo"))?))
}

#[derive(Deserialize)]
struct SectorQuery {
    game: String,
    track: String,
    #[serde(default)]
    layout: String,
}

/// Where a track layout's sectors split, as fractions of the lap (`null` until the track has been driven).
async fn sector_boundaries(State(c): State<Ctx>, Query(q): Query<SectorQuery>) -> ApiResult<Option<Vec<f32>>> {
    Ok(Json(c.tt.sector_boundaries(&q.game, &q.track, &q.layout)?))
}

#[derive(Deserialize)]
struct MapView {
    game: String,
    track: String,
    layout: String,
    rotate: u16,
    mirror: bool,
}

async fn set_map_view(State(c): State<Ctx>, Json(b): Json<MapView>) -> ApiResult<()> {
    c.tt.set_map_view(&b.game, &b.track, &b.layout, b.rotate, b.mirror)?;
    Ok(Json(()))
}

/// Destructive maintenance is only for the PC TimeTrial runs on: the server is also open to the
/// office network, and a phone must not be able to wipe data even by calling these URLs directly.
fn local_only(addr: SocketAddr) -> Result<(), Response> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "this is only available in the TimeTrial app on the PC" }))).into_response())
    }
}

fn bad_request(e: anyhow::Error) -> Response {
    ApiError(e).into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct About {
    name: &'static str,
    version: &'static str,
    /// Counts every build of this checkout (see `build.rs`); compare it to tell two copies apart.
    build_number: u32,
    /// "release" for the installed app, "development" for a dev build.
    build: &'static str,
    os: &'static str,
    webview: Option<String>,
    data_dir: Option<String>,
    db_bytes: Option<u64>,
    port: u16,
    lan_enabled: bool,
    counts: tt_core::AboutCounts,
}

/// Version, where the data lives and what's in it. Local only: it names folders on this PC.
async fn admin_about(ConnectInfo(addr): ConnectInfo<SocketAddr>, State(c): State<Ctx>) -> Result<Json<About>, Response> {
    use tauri::Manager;
    local_only(addr)?;
    let data_dir = c.app.path().app_data_dir().ok();
    // The database is spread over the main file and its write-ahead log until SQLite folds them together.
    let db_bytes = data_dir.as_ref().map(|d| {
        ["timetrial.db", "timetrial.db-wal"].iter().filter_map(|f| std::fs::metadata(d.join(f)).ok()).map(|m| m.len()).sum()
    });
    let counts = c.tt.about_counts().map_err(bad_request)?;
    Ok(Json(About {
        name: "TimeTrial",
        version: env!("CARGO_PKG_VERSION"),
        build_number: env!("TT_BUILD_NUMBER").parse().unwrap_or(0),
        build: if cfg!(debug_assertions) { "development" } else { "release" },
        os: std::env::consts::OS,
        webview: tauri::webview_version().ok(),
        data_dir: data_dir.map(|d| d.display().to_string()),
        db_bytes,
        port: PORT,
        lan_enabled: c.lan,
        counts,
    }))
}

async fn admin_count_laps(ConnectInfo(addr): ConnectInfo<SocketAddr>, State(c): State<Ctx>, Json(f): Json<LapFilter>) -> Result<Json<u32>, Response> {
    local_only(addr)?;
    c.tt.count_laps(&f).map(Json).map_err(bad_request)
}

async fn admin_delete_laps(ConnectInfo(addr): ConnectInfo<SocketAddr>, State(c): State<Ctx>, Json(f): Json<LapFilter>) -> Result<Json<usize>, Response> {
    local_only(addr)?;
    c.tt.delete_laps(&f).map(Json).map_err(bad_request)
}

async fn leaderboard(
    State(c): State<Ctx>,
    Json(q): Json<LeaderboardQuery>,
) -> ApiResult<Vec<tt_core::LeaderboardEntry>> {
    Ok(Json(c.tt.leaderboard(&q)?))
}

async fn challenges(State(c): State<Ctx>) -> ApiResult<Vec<tt_core::Challenge>> {
    Ok(Json(c.tt.challenges()?))
}

async fn create_challenge(State(c): State<Ctx>, Json(body): Json<NewChallenge>) -> ApiResult<tt_core::Challenge> {
    Ok(Json(c.tt.create_challenge(&body)?))
}

async fn delete_challenge(State(c): State<Ctx>, Path(id): Path<ChallengeId>) -> ApiResult<()> {
    c.tt.delete_challenge(id)?;
    Ok(Json(()))
}

async fn end_challenge(State(c): State<Ctx>, Path(id): Path<ChallengeId>) -> ApiResult<()> {
    c.tt.end_challenge(id)?;
    Ok(Json(()))
}

async fn challenge_leaderboard(
    State(c): State<Ctx>,
    Path(id): Path<ChallengeId>,
) -> ApiResult<Vec<tt_core::LeaderboardEntry>> {
    Ok(Json(c.tt.challenge_leaderboard(id)?))
}

async fn challenge_replay(State(c): State<Ctx>, Path(id): Path<ChallengeId>) -> ApiResult<Vec<tt_core::ReplayEntry>> {
    Ok(Json(c.tt.challenge_replay(id)?))
}

async fn events(State(c): State<Ctx>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| forward_events(socket, c.tt))
}

async fn forward_events(mut socket: WebSocket, tt: Arc<TimeTrial>) {
    let mut rx = tt.subscribe();
    loop {
        tokio::select! {
            event = rx.recv() => {
                let text = match event {
                    Ok(event) => serde_json::to_string(&event).unwrap_or_default(),
                    // Too slow to keep up: tell the client to refetch everything.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => r#"{"type":"resync"}"#.to_string(),
                    Err(_) => break,
                };
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                if !matches!(incoming, Some(Ok(_))) {
                    break;
                }
            }
        }
    }
}

/// Serves the bundled UI to browsers on the network (release builds embed it).
async fn static_asset(State(c): State<Ctx>, uri: Uri) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    // Debug builds: Vite first. A leftover `app/dist` from an earlier `npm run build` would otherwise
    // be served here and a phone would keep showing that old UI instead of the live one.
    #[cfg(debug_assertions)]
    {
        let proxied = dev_proxy(&uri).await;
        if proxied.status() != StatusCode::BAD_GATEWAY {
            return proxied;
        }
    }
    let resolver = c.app.asset_resolver();
    match resolver.get(path.to_string()).or_else(|| resolver.get("index.html".to_string())) {
        Some(asset) => ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response(),
        None => dev_proxy(&uri).await,
    }
}

/// Dev builds don't bundle the UI (Tauri loads it from Vite on :1420). So that a phone can
/// open http://<pc>:7878 while developing, with only this port needing to be reachable, forward
/// the request to Vite over loopback. Release builds always have the UI bundled.
#[cfg(debug_assertions)]
async fn dev_proxy(uri: &Uri) -> Response {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let path = uri.path_and_query().map_or("/", |p| p.as_str());
    let fetch = async {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", 1420)).await?;
        // HTTP/1.0: no chunked encoding, and the server closes the connection when done.
        let req = format!("GET {path} HTTP/1.0\r\nHost: localhost:1420\r\nAccept: */*\r\nAccept-Encoding: identity\r\n\r\n");
        stream.write_all(req.as_bytes()).await?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await?;
        anyhow::Ok(raw)
    };
    let Ok(raw) = fetch.await else {
        return (StatusCode::BAD_GATEWAY, "The Vite dev server (npm run dev, port 1420) isn't running").into_response();
    };
    let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return (StatusCode::BAD_GATEWAY, "Bad response from the Vite dev server").into_response();
    };
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse::<u16>().ok())
        .and_then(|c| StatusCode::from_u16(c).ok())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let mut response = Response::builder().status(status);
    for line in lines {
        if let Some((name, value)) = line.split_once(':')
            && ["content-type", "cache-control", "etag", "location"].contains(&name.to_ascii_lowercase().as_str())
        {
            response = response.header(name.trim(), value.trim());
        }
    }
    response.body(axum::body::Body::from(raw[split + 4..].to_vec())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

#[cfg(not(debug_assertions))]
async fn dev_proxy(_uri: &Uri) -> Response {
    (StatusCode::NOT_FOUND, "TimeTrial UI not bundled in this build").into_response()
}
