# Orbit Copilot Win7 target patch

This is `ctor` 0.8.0 from crates.io, licensed under Apache-2.0 OR MIT.

Rust's official `x86_64-win7-windows-msvc` target reports
`target_vendor="win7"` instead of `target_vendor="pc"`. The upstream 0.8.0
macros otherwise reject the target before compilation, although it uses the
same Windows COFF `.CRT$XCU` constructor section.

The local patch only extends the three Windows vendor conditions in
`src/macros/mod.rs` to accept either `pc` or `win7`. No constructor behavior or
third-party implementation code is changed.
