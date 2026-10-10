//! Local HTTP + WebSocket server.
//!
//! The desktop window, the overlay and any browser on the office network all talk to
//! TimeTrial through this one API, so there's a single code path for the UI.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tower_http::cors::CorsLayer;
use tt_core::{ChallengeId, DriverId, LapId, LeaderboardQuery, NewChallenge, TimeTrial};

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
        .route("/drivers/{id}", put(update_driver))
        .route("/seat", put(set_seat))
        .route("/laps/recent", get(recent_laps))
        .route("/laps/{id}/claim", post(claim_lap))
        .route("/combos", get(combos))
        .route("/leaderboard", post(leaderboard))
        .route("/challenges", get(challenges).post(create_challenge))
        .route("/challenges/{id}", axum::routing::delete(delete_challenge))
        .route("/challenges/{id}/leaderboard", get(challenge_leaderboard))
        .route("/challenges/{id}/end", post(end_challenge))
        .route("/settings/lan", put(set_lan))
        .route("/events", get(events));

    let router = Router::new()
        .nest("/api", api)
        .fallback(static_asset)
        .layer(CorsLayer::permissive())
        .with_state(ctx);

    let ip: IpAddr = if lan { [0, 0, 0, 0].into() } else { [127, 0, 0, 1].into() };
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(ip, PORT)).await?;
    axum::serve(listener, router).await?;
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
    let urls = if c.lan {
        local_ip_address::list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(_, ip)| match ip {
                IpAddr::V4(v4) if v4.is_private() => Some(format!("http://{v4}:{PORT}")),
                _ => None,
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(Json(ServerInfo { port: PORT, lan_enabled: c.lan, urls }))
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
    let resolver = c.app.asset_resolver();
    match resolver.get(path.to_string()).or_else(|| resolver.get("index.html".to_string())) {
        Some(asset) => ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response(),
        None => (StatusCode::NOT_FOUND, "TimeTrial UI not bundled in this build").into_response(),
    }
}
