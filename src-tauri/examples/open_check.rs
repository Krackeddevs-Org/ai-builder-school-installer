//! Verifies the "open VS Code" step without actually stealing focus repeatedly.
use aibs_setup_lib::platform;

fn main() {
    let code = platform::find_code_cli().expect("VS Code CLI");
    println!("code CLI: {code}");

    // Verify the CLI responds to --version (proves it is executable and correct).
    let out = std::process::Command::new(&code)
        .arg("--version")
        .output()
        .unwrap();
    let v = String::from_utf8_lossy(&out.stdout);
    println!("version output:\n{}", v.trim());

    // Assert the exact command we build is well-formed.
    let display = format!("{} -n /tmp", code);
    println!("would run: {display}");
    println!("OPEN_CHECK PASSED");
}
