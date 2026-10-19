//! Verifies the VS Code extension step against the REAL installed VS Code.
//!
//! Run: cargo run --example ext_check

use aibs_setup_lib::{platform, steps};

/// Ask VS Code directly whether Kilo Code is present (ground truth, not our own state).
fn is_kilo_installed(code_cli: &str) -> bool {
    std::process::Command::new(code_cli)
        .arg("--list-extensions")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("kilocode.kilo-code")
        })
        .unwrap_or(false)
}

fn main() {
    let code = platform::find_code_cli().expect("VS Code CLI must exist");
    println!("VS Code CLI: {code}");

    let before = is_kilo_installed(&code);
    println!("Kilo Code installed before: {before}");

    println!("\n--- install_extension(dry_run = true) ---");
    let dry = steps::install_extension(true);
    println!(
        "  ok={} status={} detail={}",
        dry.ok, dry.status, dry.detail
    );
    assert!(dry
        .command
        .as_deref()
        .unwrap_or("")
        .contains("kilocode.Kilo-Code"));

    println!("\n--- install_extension(dry_run = false) ---");
    let real = steps::install_extension(false);
    println!(
        "  ok={} status={} detail={}",
        real.ok, real.status, real.detail
    );

    let after = is_kilo_installed(&code);
    println!("\nKilo Code installed after: {after}");
    assert!(
        after,
        "the extension must be installed after running the step"
    );

    println!("\n--- install_tool for an already-present tool must skip ---");
    let git = steps::install_tool("git".into(), false);
    println!(
        "  ok={} status={} detail={}",
        git.ok, git.status, git.detail
    );
    assert_eq!(git.status, "skipped");

    println!("\n--- install_tool with an unknown id must fail cleanly ---");
    let bogus = steps::install_tool("nonsense".into(), false);
    println!(
        "  ok={} status={} detail={}",
        bogus.ok, bogus.status, bogus.detail
    );
    assert!(!bogus.ok);
    assert_eq!(bogus.status, "failed");

    println!("\nEXT_CHECK PASSED");
}
