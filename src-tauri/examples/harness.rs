//! Headless exercise of the real backend commands against THIS machine.
//!
//! Not a unit test — it drives the actual step functions the UI calls, so we can prove
//! the install/verify/apply pipeline works for real. Run with:
//!   cargo run --example harness -- --apply   (writes real Kilo config)
//!   cargo run --example harness              (read-only: detect + verify only)

use aibs_setup_lib::{api, kilo, platform, steps};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let do_apply = args.iter().any(|a| a == "--apply");
    let api_key = std::env::var("AIBS_TEST_KEY").unwrap_or_default();

    println!("=== 1. detect() ===");
    let report = steps::detect();
    println!("os: {}", report.os);
    for s in &report.steps {
        println!(
            "  {:<22} {:<9} {}",
            s.label,
            s.status,
            s.command.clone().unwrap_or_else(|| s.detail.clone())
        );
    }

    println!("\n=== 2. dry-run install for a missing tool ===");
    let dry = steps::install_tool("node".into(), true);
    println!(
        "  ok={} status={} detail={}",
        dry.ok, dry.status, dry.detail
    );

    println!("\n=== 3. install_extension() dry-run ===");
    let ext = steps::install_extension(true);
    println!(
        "  ok={} status={} detail={}",
        ext.ok, ext.status, ext.detail
    );

    if api_key.is_empty() {
        println!("\n(no AIBS_TEST_KEY set — skipping the network steps)");
        return;
    }

    println!("\n=== 4. verify_key() against the live gateway ===");
    let v = steps::verify_key(api_key.clone(), None, None);
    println!(
        "  ok={} latency={}ms message={}",
        v.ok, v.latency_ms, v.message
    );
    println!("  default_model={}", v.default_model);
    println!("  models ({}):", v.models.len());
    for m in &v.models {
        let tag = if *m == v.default_model {
            " <= default"
        } else {
            ""
        };
        println!("    - {m}{tag}");
    }
    if !v.ok {
        std::process::exit(1);
    }

    println!("\n=== 5. verify_key() with a preferred (remembered) model ===");
    let v2 = steps::verify_key(api_key.clone(), None, Some("gpt-5.5".to_string()));
    println!("  default_model={} (expected gpt-5.5)", v2.default_model);
    assert_eq!(v2.default_model, "gpt-5.5");

    if !do_apply {
        println!("\n=== 6. apply_config() DRY RUN ===");
        let a = steps::apply_config(
            Some(api_key.clone()),
            v.models.clone(),
            Some(v.default_model.clone()),
            false,
            true,
        );
        println!("  ok={}", a.ok);
        for l in &a.log {
            println!("  {l}");
        }
        println!("\n(pass --apply to write the real files)");
        return;
    }

    println!("\n=== 6. apply_config() REAL WRITE ===");
    println!(
        "  config target: {}",
        kilo::kilo_config_path().unwrap().display()
    );
    println!(
        "  auth   target: {}",
        kilo::kilo_auth_path().unwrap().display()
    );
    let a = steps::apply_config(
        Some(api_key.clone()),
        v.models.clone(),
        Some(v.default_model.clone()),
        false,
        false,
    );
    println!("  ok={}", a.ok);
    for l in &a.log {
        println!("  {l}");
    }
    if let Some(f) = &a.fatal {
        println!("  FATAL: {f}");
        std::process::exit(1);
    }

    println!("\n=== 7. read back what we wrote ===");
    let cfg = kilo::load_existing().expect("config must be re-readable");
    println!("  model           = {}", cfg["model"]);
    println!(
        "  baseURL         = {}",
        cfg["provider"]["aibs"]["options"]["baseURL"]
    );
    println!(
        "  apiKey          = {}",
        cfg["provider"]["aibs"]["options"]["apiKey"]
    );
    let n = cfg["provider"]["aibs"]["models"]
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);
    println!("  models written  = {n}");

    let auth_path = kilo::kilo_auth_path().unwrap();
    let auth: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&auth_path).unwrap()).unwrap();
    println!("  auth.aibs.type  = {}", auth["aibs"]["type"]);
    let klen = auth["aibs"]["key"].as_str().map(|s| s.len()).unwrap_or(0);
    println!("  auth.aibs.key   = <{klen} chars>");

    println!("\n=== 8. skill check: does the written config round-trip as valid JSON? ===");
    let raw = std::fs::read_to_string(kilo::kilo_config_path().unwrap()).unwrap();
    let _: serde_json::Value = serde_json::from_str(&raw).expect("must parse");
    println!("  valid JSON: yes");

    println!("\nDONE — config applied successfully.");
    println!("Open VS Code and click the Kilo Code icon; the 'aibs' provider should be listed.");
}
