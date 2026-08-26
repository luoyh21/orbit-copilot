fn main() {
    if std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("win7") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .expect("Cargo must provide CARGO_MANIFEST_DIR");
        println!(
            "cargo:rustc-link-search=native={manifest_dir}/vendor/webview2-com-sys/x64"
        );
    }
    tauri_build::build()
}
