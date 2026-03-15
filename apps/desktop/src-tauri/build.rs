use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    if let Err(error) = stage_bundle_resources() {
        panic!("failed to stage AgentGuard bundle resources: {error}");
    }

    tauri_build::build()
}

fn stage_bundle_resources() -> Result<(), String> {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|error| error.to_string())?);
    let workspace_root = manifest_dir
        .ancestors()
        .nth(3)
        .ok_or_else(|| "workspace root should exist".to_string())?
        .to_path_buf();
    let bundle_root = manifest_dir.join("bundle-resources");
    let runtime_root = bundle_root.join("runtime");
    let python_root = bundle_root.join("python");

    fs::create_dir_all(&runtime_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(&python_root).map_err(|error| error.to_string())?;

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    stage_runtime_binary(
        &workspace_root,
        &runtime_root.join("agentguard-daemon"),
        "agentguard-daemon",
        &profile,
    )?;
    stage_runtime_binary(
        &workspace_root,
        &runtime_root.join("agentguard-proxy"),
        "agentguard-proxy",
        &profile,
    )?;

    sync_path(
        &workspace_root.join("sdks/python/src/agentguard_sdk"),
        &python_root.join("agentguard_sdk"),
    )?;
    sync_path(
        &workspace_root.join("sdks/python/examples/live_demo_agent.py"),
        &python_root.join("live_demo_agent.py"),
    )?;
    sync_path(
        &workspace_root.join("sdks/python/examples/openai_chat_agent.py"),
        &python_root.join("openai_chat_agent.py"),
    )?;

    println!("cargo:rerun-if-changed={}", bundle_root.display());
    Ok(())
}

fn stage_runtime_binary(
    workspace_root: &Path,
    destination: &Path,
    binary_name: &str,
    profile: &str,
) -> Result<(), String> {
    let release_binary = workspace_root.join("target/release").join(binary_name);
    let debug_binary = workspace_root.join("target/debug").join(binary_name);

    if release_binary.exists() {
        return sync_path(&release_binary, destination);
    }

    if debug_binary.exists() {
        return sync_path(&debug_binary, destination);
    }

    if profile == "release" {
        return Err(format!(
            "required runtime binary `{binary_name}` was not found in target/release"
        ));
    }

    fs::write(destination, format!("placeholder for {binary_name}\n"))
        .map_err(|error| error.to_string())
}

fn sync_path(source: &Path, destination: &Path) -> Result<(), String> {
    if should_skip_python_artifact(source) {
        return Ok(());
    }

    if source.is_dir() {
        prune_python_artifacts(destination)?;
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            sync_path(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::copy(source, destination)
        .map_err(|error| format!("failed to copy {}: {error}", source.display()))?;
    Ok(())
}

fn should_skip_python_artifact(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name == "__pycache__" || name.ends_with(".pyc"))
}

fn prune_python_artifacts(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if should_skip_python_artifact(&entry_path) {
            if entry_path.is_dir() {
                fs::remove_dir_all(&entry_path).map_err(|error| error.to_string())?;
            } else {
                fs::remove_file(&entry_path).map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}
