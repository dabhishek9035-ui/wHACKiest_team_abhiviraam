fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "load_avatar",
                "save_avatar",
                "reset_avatar",
                "get_ws_token",
            ]),
        ),
    )
    .expect("failed to configure Tauri command permissions");
}
