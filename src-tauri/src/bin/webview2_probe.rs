//! Small console-only probe for the dedicated Windows 7 build.
//! It reports the HRESULT returned by Microsoft's WebView2 loader without
//! creating a Tauri window, making offline-runtime failures reproducible.

#[cfg(target_vendor = "win7")]
mod win7 {
    use std::ptr;

    #[link(name = "WebView2LoaderStatic", kind = "static")]
    #[link(name = "advapi32")]
    #[link(name = "ole32")]
    unsafe extern "system" {
        fn GetAvailableCoreWebView2BrowserVersionString(
            browser_executable_folder: *const u16,
            version_info: *mut *mut u16,
        ) -> i32;
    }

    // WebView2's tracing metadata call is optional, and Windows 7 does not
    // export it. This mirrors the successful no-op compatibility slot used by
    // the application; ERROR_NOT_SUPPORTED would abort the Loader's probe.
    unsafe extern "system" fn event_set_information(
        _registration_handle: usize,
        _information_class: u32,
        _event_information: *const core::ffi::c_void,
        _information_length: u32,
    ) -> u32 {
        0 // ERROR_SUCCESS
    }

    #[used]
    #[export_name = "__imp_EventSetInformation"]
    static EVENT_SET_INFORMATION_IMPORT: unsafe extern "system" fn(
        usize,
        u32,
        *const core::ffi::c_void,
        u32,
    ) -> u32 = event_set_information;

    fn version_from(pointer: *const u16) -> String {
        if pointer.is_null() {
            return "<null>".to_string();
        }
        let mut length = 0;
        unsafe {
            while *pointer.add(length) != 0 {
                length += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
        }
    }

    unsafe fn probe(path: *const u16) {
        let mut version = ptr::null_mut();
        let result = unsafe {
            GetAvailableCoreWebView2BrowserVersionString(path, &mut version)
        };
        println!("HRESULT=0x{:08X}", result as u32);
        println!("Version={}", version_from(version));
    }

    pub fn run() {
        let folder = std::env::args().nth(1);
        println!("OS target=x86_64-win7-windows-msvc");
        println!(
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER={}",
            std::env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER")
                .unwrap_or_else(|_| "<unset>".to_string())
        );

        if let Some(folder) = folder {
            println!("ExplicitFolder={folder}");
            let wide: Vec<u16> = folder.encode_utf16().chain(Some(0)).collect();
            unsafe { probe(wide.as_ptr()) };
        } else {
            println!("ExplicitFolder=<null; loader default/environment override>");
            unsafe { probe(ptr::null()) };
        }
    }
}

fn main() {
    #[cfg(target_vendor = "win7")]
    win7::run();

    #[cfg(not(target_vendor = "win7"))]
    eprintln!("webview2_probe is only intended for the Win7 target");
}
