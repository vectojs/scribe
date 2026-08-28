/// Example Tauri command — kept minimal for `cargo check` and as a template
/// for future filesystem helpers. The actual markdown open/save uses
/// `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-dialog` on the frontend
/// (no custom Rust glue required), but this shows the invoke pattern.
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {name}! from Scribe desktop")
}

/// Optional helper: return the app version from Cargo.toml.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Read a markdown file on the Rust side (fallback if the JS `plugin-fs`
/// scope is insufficient). Errors surface as `Err(String)` for the JS side.
#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a markdown file on the Rust side.
#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            app_version,
            read_markdown_file,
            write_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_formats() {
        assert_eq!(greet("Scribe".into()), "Hello, Scribe! from Scribe desktop");
    }

    #[test]
    fn app_version_non_empty() {
        assert!(!app_version().is_empty());
    }

    #[test]
    fn read_write_roundtrip() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("test.md");
        let path_s = path.to_string_lossy().to_string();
        write_markdown_file(path_s.clone(), "# hello\n".into())?;
        let out = read_markdown_file(path_s)?;
        assert_eq!(out, "# hello\n");
        Ok(())
    }
}
