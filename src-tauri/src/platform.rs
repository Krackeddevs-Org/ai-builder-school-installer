//! Platform detection and package-manager command building.
//!
//! Every install step is built as a `Command` that the caller executes, so the same
//! code path serves both `--dry-run` (print) and real execution.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

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
        let out = Command::new(&self.program)
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
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
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
    let out = Command::new(program).args(args).output().ok()?;
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
            // Homebrew is the only sane automated path on macOS.
            which("brew")?;
            let mut args = vec!["install"];
            if tool == Tool::Vscode {
                args.push("--cask");
            }
            args.push(formula);
            Some(CmdSpec::new("brew", &args))
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

/// Manual instructions shown when we cannot automate (unknown distro, no winget, no brew).
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
            "Homebrew is required. Install it, then re-run this wizard:".into(),
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
        // On Linux/Windows we must always have an automated path.
        if Os::current() != Os::Macos {
            for t in [Tool::Vscode, Tool::Git, Tool::Node] {
                assert!(
                    install_command(t).is_some(),
                    "{t:?} should have an install command"
                );
            }
        }
    }

    #[test]
    fn tool_labels_are_stable() {
        assert_eq!(Tool::Vscode.label(), "Visual Studio Code");
        assert_eq!(Tool::Git.label(), "Git");
        assert_eq!(Tool::Node.label(), "Node.js LTS");
    }
}
