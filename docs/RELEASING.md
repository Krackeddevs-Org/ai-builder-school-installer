# How releases are built and shipped

## The short version

**You can't build all three OSes from one machine.** That's not a Tauri flaw — it's
Apple's and Microsoft's bundler toolchains. So releases are built by **GitHub Actions on
native runners**, which is free for public repos.

Push a tag → four runners build in parallel → a draft Release appears with every
installer attached.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then go to **Actions** to watch it, and **Releases** to publish the draft.

You can also trigger it by hand: **Actions → Release → Run workflow**.

## What each platform can and cannot do

| Target | Built on | Can you cross-compile from Linux? |
|---|---|---|
| Linux `deb` / `rpm` / `AppImage` | `ubuntu-22.04` | ✅ Yes — it's the same OS |
| Windows `nsis` (.exe) | `windows-latest` | ⚠️ Possible via `cargo-xwin`, not recommended |
| Windows `msi` | `windows-latest` | ❌ **Impossible** — WiX only runs on Windows |
| macOS `dmg` / `app` | `macos-latest` | ❌ **Impossible** — needs the Apple SDK |

Per Tauri's own docs, cross-compiling Windows from Linux *"should only be used as a last
resort if local VMs or CI solutions like GitHub Actions don't work for you."*

**macOS cannot be done at all** from Linux, because the Apple SDK isn't redistributable.
No tooling fixes that.

## Which Linux file should a student download?

Not the `.deb`, and not the `.rpm`. Use the **`.AppImage`**.

A `.deb` targets Debian/Ubuntu and an `.rpm` targets Fedora/RHEL — an **Arch** student
would have to convert or extract them. The AppImage is the one file that works
everywhere: it bundles its own WebKit and 209 shared libraries, so it doesn't care what
distro you run.

Verify that claim for any build:

```bash
./scripts/verify-appimage.sh "path/to/App.AppImage"
```

It extracts the AppImage and asserts the libraries and WebKit are actually inside, so a
build that secretly depends on the host's libs fails loudly instead of breaking on a
student's machine.

## Local builds

```bash
./scripts/build-local.sh          # Linux: deb + rpm + AppImage, then verifies it
./scripts/build-local.sh          # macOS: dmg + app
```

Or the npm shortcuts:

```bash
npm run build:linux
npm run build:mac
npm run build:win     # must be run ON Windows
```

## Code signing

The builds use an **ad-hoc signature** (`"signingIdentity": "-"` in `tauri.conf.json`).
This is not optional on Apple Silicon: macOS **requires** a signature on any app
downloaded from the internet, and without one the `.dmg` reports the app *"is damaged and
can't be opened"* — which reads as malware to a student. Tauri's own docs name this exact
setting for that case.

Ad-hoc signing fixes the "damaged" hard failure. It does **not** make the app trusted, so
first launch still hits Gatekeeper:

- **macOS** — right-click the app → **Open** → **Open**. Or:
  `xattr -d com.apple.quarantine "/Applications/AI Builder School Setup.app"`
- **Windows** — SmartScreen shows "Windows protected your PC" → *More info* → *Run anyway*.

> On macOS, the plain *right-click → Open* path does **not** work when the app is
> reported as damaged — only when Gatekeeper is merely "unverified". A correctly
> ad-hoc-signed build takes the second path. If a student still sees "damaged", the
> signature is missing or broken, not merely untrusted.

Removing these prompts entirely needs a paid identity:

| Platform | Requirement | Cost |
|---|---|---|
| macOS | Apple Developer Program, then set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` as repo secrets | $99/year |
| Windows | EV code-signing certificate | a few hundred/year |

For a classroom the ad-hoc route plus clear instructions is usually acceptable. Revisit if
students start bouncing off it.

## Release checklist

1. Bump `version` in `src-tauri/tauri.conf.json` **and** `package.json` (keep them equal).
2. Commit, then tag and push the tag.
3. Wait for all four runners to go green.
4. Publish the draft Release.
5. Download the AppImage yourself and run `scripts/verify-appimage.sh` on it.
6. Hand students **one** link — the Releases page.