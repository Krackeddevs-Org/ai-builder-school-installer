# AI Builder School — Setup Wizard

**One click. Press install, paste your API key, and start building.**

A cross-platform desktop wizard that sets up everything an AI Builder School student
needs, so class time goes to building instead of installing:

**VS Code → Git → Node.js → Kilo Code extension → API key → done.**

Built with **Tauri** (Rust backend, plain HTML/CSS/JS frontend) in the
**AI Builder School brand style**.

---

## What it does

1. **Checks first, installs second.** Detects what's already on your machine and skips
   it. Existing installs are never overwritten.
2. **Installs what's missing** using the right tool per OS:
   - Windows → `winget`
   - macOS → `brew`
   - Linux → `pacman` / `apt` / `dnf` (auto-detected)
3. **Installs the Kilo Code extension** into VS Code.
4. **Connects your API key.** Paste it, hit Test connection, and the wizard pings the
   live gateway and fetches your available models.
5. **Writes the Kilo config** so the provider is ready the moment you open VS Code.
6. **Verifies at the end** and tells you exactly what to do next.

You can also **skip the API key** and use Kilo Code's own free models instead.

## After running it

Open VS Code, open your project folder, click the **Kilo Code** icon in the sidebar —
your models are already there. That's it.

---

## Default model

`deepseek-v4.1-flash` — fast, cheap and plenty capable for the course.

You can change it during setup, or later: the wizard fetches the live model list from
the gateway, so you pick from what actually exists right now. Your choice is remembered
for next time.

| Model | Notes |
|---|---|
| `deepseek-v4.1-flash` | **default** |
| `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` | |
| `gpt-5.5` | |
| `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` | |
| `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol` | |
| `gpt-image-2` | image generation |

---

## Where to get your API key

Your **KrackedDevs profile dashboard** — <https://krackeddevs.com/dashboard/profile>
(the wizard links straight to it).

Gateway: `https://litellm.rapidscreen.io/v1` (OpenAI-compatible).

---

## For developers

### Prerequisites

- Rust (1.77+) — <https://rustup.rs>
- Node.js 18+ (only for the Tauri CLI and UI tests)
- Linux only: `webkit2gtk-4.1`, `base-devel`

### Run it

```bash
npm install
npm run dev            # live-reloading dev build
```

### Test it

```bash
npm run test:ui        # 31 headless UI tests (real browser, real flow)
cd src-tauri
cargo test             # 20 unit tests
```

Live integration tests hit the real gateway — they're `#[ignore]`d so they never run by
accident:

```bash
AIBS_TEST_KEY=sk-... cargo test --test live -- --ignored --nocapture
```

Backend harness that drives the real install/verify/apply pipeline:

```bash
AIBS_TEST_KEY=sk-... cargo run --example harness             # dry run
AIBS_TEST_KEY=sk-... cargo run --example harness -- --apply  # writes real config
cargo run --example ext_check                                # VS Code extension step
```

### Build installers

```bash
npm run build:linux    # .deb, .AppImage, .rpm
npm run build:mac      # .dmg, .app
npm run build:win      # .msi, .exe (NSIS)
```

> Cross-compiling: macOS and Windows bundles must be built **on** macOS and Windows
> respectively (Tauri/WebKit requirement). Use the GitHub Actions workflow in
> `.github/workflows/release.yml`, which builds all three on native runners.

---

## How it works

```
src-tauri/src/
├── platform.rs   OS detection, package-manager commands, VS Code CLI discovery
├── api.rs        live gateway client: key validation + model list
├── kilo.rs       kilo.jsonc read/merge/write, credential store, env persistence
├── steps.rs      the wizard's step orchestration (Tauri commands)
└── lib.rs        command registration

ui/
├── index.html    the three screens
├── app.css       AI Builder School design tokens
├── app.js        flow logic
└── icons.js      inline SVG icon set (no emoji, no icon fonts)
```

### Important implementation notes

- **Kilo config lives at `~/.config/kilo/kilo.jsonc` on ALL platforms**, including
  Windows (`C:\Users\<you>\.config\kilo\kilo.jsonc`). Not `%APPDATA%`.
- **The API key is written inline** into the config. Kilo resolves `{env:VAR}` only if
  the variable is already in the running process, so a GUI-launched VS Code would fail
  to see a key we put in a shell profile. Inline just works. Pass `use_env: true` if you
  want the placeholder instead.
- **We write both `kilo.jsonc` and `auth.json`.** An inline key alone doesn't create
  Kilo's auth-store entry, which makes its Settings UI show an empty key field
  (Kilo issue #10139).
- **Existing config is deep-merged and backed up** to `kilo.jsonc.bak` first.
- **macOS `code` is not on PATH by default** — we resolve the app-bundle binary at
  `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
- **`/v1/models` requires a key** (401 without one), so models can only be listed
  *after* the student enters theirs.

---

## Status

Working and tested on **Linux (Arch/EndeavourOS)**. macOS and Windows bundle targets are
configured and the platform code paths are written, pending real-machine verification.

Verified end-to-end: a clean-environment Kilo CLI run (`env -i`, no key variable)
successfully answered a prompt through the `aibs/deepseek-v4.1-flash` provider that the
wizard wrote.

---

setup by [ar-Raqmi](https://ar-raqmi.net/)