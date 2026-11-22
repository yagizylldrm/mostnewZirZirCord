#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// WebKitGTK workarounds for common Linux setups. They must be set before GTK/WebKit start.
/// Every variable can still be overridden by exporting it before launching the app.
#[cfg(target_os = "linux")]
fn linux_webkit_workarounds() {
    use std::env::{set_var, var_os};
    use std::fs;

    // Inside Flatpak the runtime already provides a working WebKit + sandbox.
    if var_os("FLATPAK_ID").is_some() {
        return;
    }

    // The DMABUF renderer yields a blank/black window or an "EGL_BAD_PARAMETER" crash on many
    // Arch/NVIDIA/Wayland and Mesa-mismatch (AppImage) setups.
    if var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // WebKit's bubblewrap sandbox needs unprivileged user namespaces. Ubuntu 23.10+/24.04
    // (AppArmor) and some hardened kernels block them, which makes the web process die and the
    // window never appear. We only load our own UI, so fall back to no sandbox in that case.
    let read = |p: &str| fs::read_to_string(p).ok().map(|s| s.trim().to_owned());
    let userns_blocked = read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns").as_deref() == Some("1")
        || read("/proc/sys/kernel/unprivileged_userns_clone").as_deref() == Some("0")
        || read("/proc/sys/user/max_user_namespaces").as_deref() == Some("0");
    if userns_blocked && var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
        set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_webkit_workarounds();
    zirzircord_desktop_lib::run()
}
