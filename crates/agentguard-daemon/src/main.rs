use agentguard_daemon::{DaemonConfig, run};

#[tokio::main]
async fn main() -> Result<(), agentguard_daemon::DaemonApiError> {
    run(DaemonConfig::from_env()?).await
}
