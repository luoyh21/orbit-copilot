# webview2-com-sys

## Orbit Copilot vendoring note

This local patch keeps the `webview2-com-sys` 0.38.2 Rust bindings while
replacing its native loader binaries with the official Microsoft WebView2 SDK
1.0.1518.46 package. Microsoft identifies SDK 1.0.1519 and later as unsupported
on Windows 7, so the loader version is deliberately fixed for the dedicated
Win7 build.

- NuGet package: `Microsoft.Web.WebView2` 1.0.1518.46
- Package SHA-256: `63020b2d569d09a2098ae1ca20dd4cc281885f794aa00fc8812c6ab52dd49618`
- Microsoft binary license: `MICROSOFT-WEBVIEW2-LICENSE.txt`
- Upstream Rust crate: `webview2-com-sys` 0.38.2 (MIT)
This crate implements unsafe Rust bindings for the [WebView2](https://aka.ms/webview2) COM APIs using the [Windows](https://github.com/microsoft/windows-rs) crate.

## Getting Started
This crate has a friendlier wrapper in [webview2-com](https://crates.io/crates/webview2-com).
