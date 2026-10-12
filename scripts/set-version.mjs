// Sets the app version everywhere it is written down, for a release.
//
//   node scripts/set-version.mjs patch     0.2.0 -> 0.2.1
//   node scripts/set-version.mjs minor     0.2.0 -> 0.3.0
//   node scripts/set-version.mjs major     0.2.0 -> 1.0.0
//   node scripts/set-version.mjs 1.4.0     exactly that
//
// The version lives in [workspace.package] in Cargo.toml (see docs/building.md); this also keeps
// app/package.json, app/package-lock.json and the workspace crates in Cargo.lock in step, so a
// release commit has no leftovers. Prints the new version as `version=X.Y.Z` (the release
// workflow reads it).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => join(root, p);
const read = (p) => readFileSync(file(p), "utf8");

const cargo = read("Cargo.toml");
const current = cargo.match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
if (!current) throw new Error("Couldn't find the version under [workspace.package] in Cargo.toml");

const arg = process.argv[2];
const [major, minor, patch] = current.split(".").map(Number);
const next =
  arg === "major" ? `${major + 1}.0.0`
  : arg === "minor" ? `${major}.${minor + 1}.0`
  : arg === "patch" ? `${major}.${minor}.${patch + 1}`
  : arg;
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("Usage: node scripts/set-version.mjs patch|minor|major|X.Y.Z");
  process.exit(1);
}
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
// Installed copies only update to a higher version, so a release must go up.
if (!newer(next, current)) throw new Error(`${next} isn't newer than the current version, ${current}`);

writeFileSync(file("Cargo.toml"), cargo.replace(/(\[workspace\.package\][^[]*?\nversion\s*=\s*")[^"]+"/, `$1${next}"`));

// Workspace crates are the Cargo.lock entries with no `source` (everything else comes from crates.io).
const lock = read("Cargo.lock").replace(/\[\[package\]\]\nname = "[^"]+"\nversion = "([^"]+)"\n(?!source)/g, (entry, v) =>
  v === current ? entry.replace(`version = "${current}"`, `version = "${next}"`) : entry,
);
writeFileSync(file("Cargo.lock"), lock);

for (const p of ["app/package.json", "app/package-lock.json"]) {
  const json = JSON.parse(read(p));
  json.version = next;
  if (json.packages?.[""]) json.packages[""].version = next;
  writeFileSync(file(p), JSON.stringify(json, null, 2) + "\n");
}

console.log(`version=${next}`);
