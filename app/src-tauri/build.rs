use std::path::PathBuf;

/// The build number: a counter kept in `.build-number` at the repository root (git-ignored, so it is
/// per checkout). It goes up by one every time this build script runs, which is every time the app is
/// compiled after a source change (dev rebuilds, tests, release builds), and is baked into the exe as
/// `TT_BUILD_NUMBER`. `scripts/build.ps1` reads the file to name the files it packages.
fn next_build_number() -> u32 {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR")).join("../..");
    let file = root.join(".build-number");
    let n = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0) + 1;
    if let Err(e) = std::fs::write(&file, n.to_string()) {
        println!("cargo:warning=couldn't update {}: {e}", file.display());
    }
    n
}

fn main() {
    // Re-run (and so count a new build) when anything that ends up in the exe changes: this crate, the
    // Rust crates it uses, and the UI that release builds embed. Not on the counter file itself.
    for path in ["src", "../src", "../public", "../index.html", "../dist", "../../crates", "../../Cargo.toml"] {
        println!("cargo:rerun-if-changed={path}");
    }
    println!("cargo:rustc-env=TT_BUILD_NUMBER={}", next_build_number());
    tauri_build::build()
}
