//! Platform detection and package-manager command building.
//!
//! Every install step is built as a `Command` that the caller executes, so the same
//! code path serves both `--dry-run` (print) and real execution.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Os {
    Windows,
    Macos,
    Linux,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }
}

/// A single command to run, renderable for dry-run output.
#[derive(Debug, Clone, Serialize)]
pub struct CmdSpec {
    pub program: String,
    pub args: Vec<String>,
    /// Human-readable one-liner shown in the UI log.
    pub display: String,
}

impl CmdSpec {
    pub fn new(program: &str, args: &[&str]) -> Self {
        let display = if args.is_empty() {
            program.to_string()
        } else {
            format!("{} {}", program, args.join(" "))
        };
        CmdSpec {
            program: program.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            display,
        }
    }

    pub fn run(&self) -> Result<String, String> {
        let out = command(&self.program)
            .args(&self.args)
            .output()
            .map_err(|e| format!("failed to run `{}`: {e}", self.display))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !out.status.success() {
            return Err(if stderr.is_empty() {
                format!("`{}` exited with {}", self.display, out.status)
            } else {
                format!("`{}` failed: {}", self.display, stderr)
            });
        }
        Ok(if stdout.is_empty() { stderr } else { stdout })
    }
}

/// A tool we may need to install.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Vscode,
    Git,
    Node,
}

impl Tool {
    pub fn label(self) -> &'static str {
        match self {
            Tool::Vscode => "Visual Studio Code",
            Tool::Git => "Git",
            Tool::Node => "Node.js LTS",
        }
    }
}

/// Result of probing for an installed tool.
#[derive(Debug, Clone, Serialize)]
pub struct Probe {
    pub tool: Tool,
    pub found: bool,
    /// Version string if we could read one.
    pub version: Option<String>,
    /// Path to the primary executable, if found.
    pub path: Option<String>,
}

/// Directories where package managers drop binaries but a double-clicked macOS `.app`
/// does not look. launchd hands GUI apps a bare `/usr/bin:/bin:/usr/sbin:/sbin` and never
/// sources `~/.zprofile`, so without these Homebrew (and everything it installs) is
/// invisible even when it works fine in Terminal. No-op on other platforms.
fn well_known_bin_dirs_for(os: Os) -> Vec<PathBuf> {
    match os {
        Os::Macos => ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]
            .iter()
            .map(PathBuf::from)
            .collect(),
        Os::Linux | Os::Windows => Vec::new(),
    }
}

/// Well-known dirs that actually exist right now. Checked on every call (not cached) so
/// a Homebrew installed mid-run becomes visible without restarting the app.
fn well_known_bin_dirs() -> Vec<PathBuf> {
    well_known_bin_dirs_for(Os::current())
        .into_iter()
        .filter(|d| d.is_dir())
        .collect()
}

/// `existing` with `extra` prepended (so brew's tools win over the system shims).
/// With nothing to add, `existing` comes back untouched rather than re-encoded.
fn path_with_dirs(existing: Option<OsString>, extra: &[PathBuf]) -> OsString {
    let existing = existing.unwrap_or_default();
    if extra.is_empty() {
        return existing;
    }
    let mut dirs: Vec<PathBuf> = extra.to_vec();
    dirs.extend(std::env::split_paths(&existing).filter(|d| !extra.contains(d)));
    // join_paths only fails if a dir contains the separator; keep the original PATH then.
    std::env::join_paths(dirs).unwrap_or(existing)
}

/// The PATH every lookup and child command should use: the process PATH plus the
/// well-known bin dirs. Computed rather than written back with `set_var`, so there is no
/// global mutation to race with Tauri's threads.
pub fn search_path() -> OsString {
    path_with_dirs(std::env::var_os("PATH"), &well_known_bin_dirs())
}

/// The one place child processes are created: corrected PATH, and no stdin so anything
/// that wants a password (sudo, installers) fails fast instead of hanging a GUI with no TTY.
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    // Only override when we have something to add; otherwise leave the env alone.
    if !well_known_bin_dirs().is_empty() {
        cmd.env("PATH", search_path());
    }
    cmd
}

/// Where `brew` lives under `root`. Apple silicon first, then Intel. Parameterised on
/// `root` only so tests can point it at a temp dir.
fn brew_candidates(root: &Path) -> [PathBuf; 2] {
    [
        root.join("opt/homebrew/bin/brew"),
        root.join("usr/local/bin/brew"),
    ]
}

/// Locate Homebrew by absolute path, because PATH is useless for bundled macOS apps
/// (see `well_known_bin_dirs_for`). `which` is the last resort for custom installs.
pub fn find_brew() -> Option<String> {
    find_brew_under(Path::new("/"), which)
}

fn find_brew_under(root: &Path, fallback: impl FnOnce(&str) -> Option<String>) -> Option<String> {
    brew_candidates(root)
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| fallback("brew"))
}

/// Where the official installer puts brew on this CPU. Used to build the install command
/// before brew exists; `install_command` is rebuilt once the installer has run.
fn default_brew_path() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "/opt/homebrew/bin/brew"
    } else {
        "/usr/local/bin/brew"
    }
}

/// Official Homebrew installer, run non-interactively. A GUI has no TTY, so NONINTERACTIVE
/// stops it prompting; it then needs passwordless sudo and aborts (rather than hangs, as
/// stdin is null) when it doesn't have it. `None` when not on macOS or brew is present.
pub fn brew_bootstrap_command() -> Option<CmdSpec> {
    if Os::current() != Os::Macos || find_brew().is_some() {
        return None;
    }
    Some(brew_installer_spec())
}

/// The installer command itself, split out so its shape can be checked on any machine.
fn brew_installer_spec() -> CmdSpec {
    CmdSpec::new(
        "/bin/bash",
        &[
            "-c",
            "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL --connect-timeout 15 \
             https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
        ],
    )
}

/// Make sure Homebrew exists, installing it if needed. The `Err` is a short,
/// student-facing reason, not raw installer output.
pub fn ensure_brew() -> Result<(), String> {
    let Some(bootstrap) = brew_bootstrap_command() else {
        return Ok(());
    };
    bootstrap.run().map_err(|e| brew_install_error(&e))?;
    // Don't trust the exit code alone: later steps need the binary itself.
    if find_brew().is_none() {
        return Err("The Homebrew installer finished but brew still isn't there.".into());
    }
    Ok(())
}

/// Turn raw installer stderr into one sentence a student can act on.
fn brew_install_error(raw: &str) -> String {
    let raw = raw.to_lowercase();
    if ["sudo", "administrator", "password", "terminal is required"]
        .iter()
        .any(|k| raw.contains(k))
    {
        "Homebrew needs an administrator password, which this app can't type for you.".into()
    } else if ["could not resolve", "curl:", "connection", "timed out"]
        .iter()
        .any(|k| raw.contains(k))
    {
        "Couldn't download Homebrew. Check your internet connection.".into()
    } else {
        "Homebrew couldn't be installed automatically.".into()
    }
}

/// Locate the `code` CLI. macOS in particular does NOT put it on PATH by default,
/// so we check the well-known app-bundle path explicitly.
pub fn find_code_cli() -> Option<String> {
    // 1. On PATH
    for name in ["code", "code-insiders", "codium"] {
        if let Some(p) = which(name) {
            return Some(p);
        }
    }
    // 2. Known absolute locations per OS
    let candidates: Vec<PathBuf> = match Os::current() {
        Os::Macos => vec![
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code".into(),
            "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
                .into(),
        ],
        Os::Linux => vec![
            "/usr/share/code/bin/code".into(),
            "/usr/bin/code".into(),
            "/snap/bin/code".into(),
            "/var/lib/flatpak/exports/bin/com.visualstudio.code".into(),
            "/opt/visual-studio-code/bin/code".into(),
        ],
        Os::Windows => {
            let mut v = Vec::new();
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                v.push(
                    PathBuf::from(&local)
                        .join("Programs")
                        .join("Microsoft VS Code")
                        .join("bin")
                        .join("code.cmd"),
                );
            }
            if let Ok(pf) = std::env::var("ProgramFiles") {
                v.push(
                    PathBuf::from(&pf)
                        .join("Microsoft VS Code")
                        .join("bin")
                        .join("code.cmd"),
                );
            }
            v
        }
    };
    candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}

/// Minimal `which` — avoids pulling a crate for one function.
pub fn which(name: &str) -> Option<String> {
    for dir in std::env::split_paths(&search_path()) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
        #[cfg(target_os = "windows")]
        {
            for ext in ["exe", "cmd", "bat"] {
                let c = dir.join(format!("{name}.{ext}"));
                if c.is_file() {
                    return Some(c.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

fn version_of(program: &str, args: &[&str]) -> Option<String> {
    let out = command(program).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    Some(s.lines().next().unwrap_or("").to_string())
}

pub fn probe(tool: Tool) -> Probe {
    match tool {
        Tool::Vscode => {
            let path = find_code_cli();
            let version = path.as_ref().and_then(|p| version_of(p, &["--version"]));
            Probe {
                found: path.is_some(),
                version,
                path,
                tool,
            }
        }
        Tool::Git => {
            let path = which("git");
            let version = path.as_ref().and_then(|p| version_of(p, &["--version"]));
            Probe {
                found: path.is_some(),
                version,
                path,
                tool,
            }
        }
        Tool::Node => {
            let path = which("node");
            let version = path.as_ref().and_then(|p| version_of(p, &["--version"]));
            Probe {
                found: path.is_some(),
                version,
                path,
                tool,
            }
        }
    }
}

/// Which Linux distro family, for picking the right package manager.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinuxFamily {
    Arch,
    Debian,
    Fedora,
    Other,
}

pub fn linux_family() -> LinuxFamily {
    let id = std::fs::read_to_string("/etc/os-release")
        .unwrap_or_default()
        .to_lowercase();
    if which("pacman").is_some() || id.contains("arch") || id.contains("endeavouros") {
        LinuxFamily::Arch
    } else if which("apt-get").is_some() || id.contains("debian") || id.contains("ubuntu") {
        LinuxFamily::Debian
    } else if which("dnf").is_some() || id.contains("fedora") {
        LinuxFamily::Fedora
    } else {
        LinuxFamily::Other
    }
}

/// Build the install command for a tool. `None` = we have no automated path and the
/// UI must show manual instructions instead of failing silently.
pub fn install_command(tool: Tool) -> Option<CmdSpec> {
    match Os::current() {
        Os::Windows => {
            let id = match tool {
                Tool::Vscode => "Microsoft.VisualStudioCode",
                Tool::Git => "Git.Git",
                Tool::Node => "OpenJS.NodeJS.LTS",
            };
            Some(CmdSpec::new(
                "winget",
                &[
                    "install",
                    "--id",
                    id,
                    "-e",
                    "--accept-source-agreements",
                    "--accept-package-agreements",
                    "--silent",
                ],
            ))
        }
        Os::Macos => {
            let formula = match tool {
                Tool::Vscode => "visual-studio-code",
                Tool::Git => "git",
                Tool::Node => "node",
            };
            // Homebrew is the only sane automated path on macOS. Absolute path, since
            // PATH won't have it; if it's missing, `ensure_brew` installs it to the
            // default location before this command runs.
            let brew = find_brew().unwrap_or_else(|| default_brew_path().to_string());
            let mut args = vec!["install"];
            if tool == Tool::Vscode {
                args.push("--cask");
            }
            args.push(formula);
            Some(CmdSpec::new(&brew, &args))
        }
        Os::Linux => match linux_family() {
            LinuxFamily::Arch => Some(CmdSpec::new(
                "sudo",
                &["pacman", "-S", "--needed", "--noconfirm", arch_pkg(tool)],
            )),
            LinuxFamily::Debian => Some(CmdSpec::new(
                "sudo",
                &["apt-get", "install", "-y", debian_pkg(tool)],
            )),
            LinuxFamily::Fedora => Some(CmdSpec::new(
                "sudo",
                &["dnf", "install", "-y", fedora_pkg(tool)],
            )),
            LinuxFamily::Other => None,
        },
    }
}

fn arch_pkg(tool: Tool) -> &'static str {
    match tool {
        Tool::Vscode => "code",
        Tool::Git => "git",
        Tool::Node => "nodejs",
    }
}
fn debian_pkg(tool: Tool) -> &'static str {
    match tool {
        // `code` is not in Debian main; document the manual path in the UI.
        Tool::Vscode => "code",
        Tool::Git => "git",
        Tool::Node => "nodejs",
    }
}
fn fedora_pkg(tool: Tool) -> &'static str {
    match tool {
        Tool::Vscode => "code",
        Tool::Git => "git",
        Tool::Node => "nodejs",
    }
}

/// Manual instructions shown when we cannot automate (unknown distro, no winget, or the
/// Homebrew auto-install failed — the caller prepends the specific reason).
pub fn manual_instructions(tool: Tool) -> Vec<String> {
    match (Os::current(), tool) {
        (Os::Windows, Tool::Vscode) => vec![
            "winget not available. Install 'App Installer' from the Microsoft Store, or download VS Code:".into(),
            "https://code.visualstudio.com/download".into(),
        ],
        (Os::Windows, Tool::Git) => vec![
            "winget not available. Download Git for Windows:".into(),
            "https://git-scm.com/download/win".into(),
        ],
        (Os::Windows, Tool::Node) => vec![
            "winget not available. Download Node.js LTS:".into(),
            "https://nodejs.org/en/download".into(),
        ],
        (Os::Macos, _) => vec![
            "Install Homebrew yourself in Terminal, then re-run this wizard:".into(),
            "https://brew.sh".into(),
        ],
        (Os::Linux, Tool::Vscode) => vec![
            "Could not detect your package manager. Install VS Code manually:".into(),
            "https://code.visualstudio.com/docs/setup/linux".into(),
        ],
        (Os::Linux, Tool::Git) => vec![
            "Install git with your distro's package manager.".into(),
            "e.g. pacman -S git  |  apt install git  |  dnf install git".into(),
        ],
        (Os::Linux, Tool::Node) => vec![
            "Install Node.js LTS with your distro's package manager.".into(),
            "e.g. pacman -S nodejs npm  |  apt install nodejs npm".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_current_is_known() {
        let os = Os::current();
        assert!(matches!(os, Os::Windows | Os::Macos | Os::Linux));
    }

    #[test]
    fn cmdspec_display_formats() {
        let c = CmdSpec::new("brew", &["install", "git"]);
        assert_eq!(c.display, "brew install git");
        assert_eq!(c.program, "brew");
        assert_eq!(c.args, vec!["install", "git"]);
    }

    #[test]
    fn cmdspec_display_without_args() {
        let c = CmdSpec::new("git", &[]);
        assert_eq!(c.display, "git");
    }

    #[test]
    fn install_command_exists_for_known_platforms() {
        // Linux/Windows always have one; macOS does too now, since a missing Homebrew is
        // installed on the fly rather than reported as manual.
        for t in [Tool::Vscode, Tool::Git, Tool::Node] {
            assert!(
                install_command(t).is_some(),
                "{t:?} should have an install command"
            );
        }
    }

    /// A throwaway dir tree under the OS temp dir, removed on drop.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("abs-test-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempRoot(dir)
        }

        fn touch(&self, rel: &str) -> PathBuf {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "#!/bin/sh\n").unwrap();
            p
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn find_brew_finds_apple_silicon_location() {
        let root = TempRoot::new("brew-arm");
        let brew = root.touch("opt/homebrew/bin/brew");
        let found = find_brew_under(&root.0, |_| None);
        assert_eq!(found, Some(brew.to_string_lossy().to_string()));
    }

    #[test]
    fn find_brew_prefers_apple_silicon_over_intel() {
        let root = TempRoot::new("brew-both");
        let arm = root.touch("opt/homebrew/bin/brew");
        root.touch("usr/local/bin/brew");
        let found = find_brew_under(&root.0, |_| None);
        assert_eq!(found, Some(arm.to_string_lossy().to_string()));
    }

    #[test]
    fn find_brew_falls_back_to_intel_then_which() {
        let root = TempRoot::new("brew-intel");
        assert_eq!(
            find_brew_under(&root.0, |n| Some(format!("/custom/{n}"))),
            Some("/custom/brew".to_string()),
            "nothing at known locations should defer to which()"
        );
        let intel = root.touch("usr/local/bin/brew");
        assert_eq!(
            find_brew_under(&root.0, |_| panic!(
                "which() must not run when brew is found"
            )),
            Some(intel.to_string_lossy().to_string())
        );
    }

    #[test]
    fn find_brew_none_when_absent() {
        let root = TempRoot::new("brew-none");
        assert_eq!(find_brew_under(&root.0, |_| None), None);
    }

    #[test]
    fn macos_well_known_dirs_include_homebrew() {
        let dirs = well_known_bin_dirs_for(Os::Macos);
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
    }

    #[test]
    fn other_platforms_have_no_well_known_dirs() {
        assert!(well_known_bin_dirs_for(Os::Linux).is_empty());
        assert!(well_known_bin_dirs_for(Os::Windows).is_empty());
    }

    #[test]
    fn path_with_dirs_prepends_homebrew_to_launchd_path() {
        // Build the launchd PATH with the HOST separator, so this test asserts the same
        // thing on Windows (where `;` is the separator and `/usr/bin` means nothing).
        let bare_dirs = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
        let bare = std::env::join_paths(bare_dirs).unwrap();
        let extra = well_known_bin_dirs_for(Os::Macos);
        let out = path_with_dirs(Some(bare), &extra);
        let parts: Vec<PathBuf> = std::env::split_paths(&out).collect();

        // Homebrew is prepended so its tools win over the system shims.
        assert_eq!(parts[0], PathBuf::from("/opt/homebrew/bin"));
        // ...and every original entry survives.
        for d in bare_dirs {
            assert!(
                parts.contains(&PathBuf::from(d)),
                "original entry {d} was dropped"
            );
        }
    }

    #[test]
    fn path_with_dirs_does_not_duplicate_existing_entries() {
        let existing = std::env::join_paths(["/usr/bin", "/opt/homebrew/bin"]).unwrap();
        let extra = vec![PathBuf::from("/opt/homebrew/bin")];
        let out = path_with_dirs(Some(existing), &extra);
        let count = std::env::split_paths(&out)
            .filter(|d| d == Path::new("/opt/homebrew/bin"))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn path_with_dirs_is_identity_with_nothing_to_add() {
        let existing = OsString::from("/usr/bin:/bin");
        assert_eq!(path_with_dirs(Some(existing.clone()), &[]), existing);
        assert_eq!(path_with_dirs(None, &[]), OsString::new());
    }

    #[test]
    fn search_path_keeps_every_process_path_entry() {
        let out = search_path();
        let have: Vec<PathBuf> = std::env::split_paths(&out).collect();
        for d in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
            assert!(have.contains(&d), "{d:?} was dropped from PATH");
        }
    }

    #[test]
    fn brew_installer_spec_is_well_formed() {
        let c = brew_installer_spec();
        assert_eq!(c.program, "/bin/bash");
        assert_eq!(c.args.len(), 2);
        assert_eq!(c.args[0], "-c");
        assert!(c.args[1].starts_with("NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL "));
        assert!(c.args[1]
            .ends_with("https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""));
        assert!(
            !c.args[1].contains("  "),
            "line continuation left stray spaces"
        );
        assert!(c.display.starts_with("/bin/bash -c NONINTERACTIVE=1"));
    }

    #[test]
    fn brew_bootstrap_command_only_when_brew_missing_on_macos() {
        let needed = brew_bootstrap_command().is_some();
        assert_eq!(needed, Os::current() == Os::Macos && find_brew().is_none());
    }

    #[test]
    fn brew_install_error_explains_the_cause() {
        assert!(brew_install_error("Need sudo access on macOS").contains("administrator password"));
        assert!(
            brew_install_error("sudo: a terminal is required to read the password")
                .contains("administrator password")
        );
        assert!(brew_install_error("curl: (6) Could not resolve host").contains("internet"));
        assert!(brew_install_error("???").contains("couldn't be installed"));
    }

    #[test]
    fn macos_brew_install_command_uses_absolute_path() {
        if Os::current() != Os::Macos {
            return;
        }
        let c = install_command(Tool::Node).expect("macOS always has a brew command");
        assert!(c.program.ends_with("/brew"), "got {}", c.program);
        assert!(Path::new(&c.program).is_absolute());
        assert_eq!(c.args, vec!["install", "node"]);
        let code = install_command(Tool::Vscode).unwrap();
        assert_eq!(code.args, vec!["install", "--cask", "visual-studio-code"]);
    }

    #[test]
    fn tool_labels_are_stable() {
        assert_eq!(Tool::Vscode.label(), "Visual Studio Code");
        assert_eq!(Tool::Git.label(), "Git");
        assert_eq!(Tool::Node.label(), "Node.js LTS");
    }
}
