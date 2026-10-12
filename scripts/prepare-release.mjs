// Gathers what a GitHub release carries, from what scripts/build.ps1 left in ./dist.
//
//   node scripts/prepare-release.mjs <version> <owner/repo>
//
// Writes ./release with:
//   * the versioned files from dist (installer, portable exe and zip, README, checksums),
//   * BinIt-setup.exe and BinIt-portable.exe: the same files under names that never change, so
//     .../releases/latest/download/BinIt-setup.exe always gets the newest one,
//   * latest.json: what installed copies read to find, download and verify an update,
//   * notes.md: the release notes (the commits since the last release).
// Run it before the release commit is made, so "since the last release" is right.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [version, repo] = process.argv.slice(2);
if (!version || !repo) {
  console.error("Usage: node scripts/prepare-release.mjs <version> <owner/repo>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(root, "release");
const tag = `v${version}`;
const download = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

const files = readdirSync(dist);
const find = (suffix) => {
  const name = files.find((f) => f.startsWith(`BinIt-${version}-`) && f.endsWith(suffix));
  if (!name) throw new Error(`dist has no BinIt-${version}-*${suffix}. Was the build signed (TAURI_SIGNING_PRIVATE_KEY)?`);
  return name;
};
const setup = find("-setup.exe");
const signature = readFileSync(join(dist, find("-setup.exe.sig")), "utf8").trim();
const portable = find("-portable.exe");

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of files) if (!f.endsWith(".sig")) copyFileSync(join(dist, f), join(out, f));
copyFileSync(join(dist, setup), join(out, "BinIt-setup.exe"));
copyFileSync(join(dist, portable), join(out, "BinIt-portable.exe"));

// What changed: commit subjects since the previous release tag.
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let previous = null;
try {
  previous = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
} catch {
  // No release yet.
}
const changes = previous
  ? git("log", "--no-merges", "--pretty=format:%s", `${previous}..HEAD`)
      .split("\n")
      .filter((s) => s && !/^Release v\d/.test(s))
      .map((s) => `- ${s}`)
  : [];
const whatsNew = previous
  ? changes.length > 0 ? changes.join("\n") : "- Small fixes and tidying up."
  : "- The first release on GitHub. From here on, installed copies update themselves when they start.";

writeFileSync(
  join(out, "latest.json"),
  JSON.stringify(
    {
      version,
      notes: whatsNew,
      pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      platforms: { "windows-x86_64": { signature, url: download(setup) } },
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(out, "notes.md"),
  `## What's new

${whatsNew}

## Download

| | |
|---|---|
| **Installer** | [BinIt-setup.exe](${download("BinIt-setup.exe")}): Start menu entry, and updates itself every time it starts |
| **Portable** | [BinIt-portable.exe](${download("BinIt-portable.exe")}): no install, run it from anywhere. Doesn't update itself |

Already installed? Nothing to do: Bin It installs this the next time it starts.
Windows 10/11 with the WebView2 runtime. The app isn't code-signed, so SmartScreen may ask once ("More info", "Run anyway").
${previous ? `\n**Full list of changes**: https://github.com/${repo}/compare/${previous}...${tag}\n` : ""}`,
);

console.log(`Release files for ${tag} are in ${out}:`);
for (const f of readdirSync(out)) console.log(`  ${f}`);
