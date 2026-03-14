use agentguard_proxy::{ProxyConfig, run};

#[tokio::main]
async fn main() -> Result<(), agentguard_proxy::ProxyError> {
    run(ProxyConfig::from_env()?).await
}
