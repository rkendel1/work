use std::env;

pub struct Config {
    pub convex_url: String,
    pub convex_admin_key: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::from_values(env::var("CONVEX_URL").ok(), env::var("CONVEX_ADMIN_KEY").ok())
    }

    fn from_values(convex_url: Option<String>, convex_admin_key: Option<String>) -> Result<Self, String> {
        let convex_url = convex_url.filter(|value| !value.trim().is_empty());
        let convex_admin_key = convex_admin_key.filter(|value| !value.trim().is_empty());

        match (convex_url, convex_admin_key) {
            (Some(convex_url), Some(convex_admin_key)) => Ok(Self {
                convex_url,
                convex_admin_key,
            }),
            _ => Err("missing required CONVEX_URL and/or CONVEX_ADMIN_KEY".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_values_returns_config_when_both_values_exist() {
        let config = Config::from_values(
            Some("https://example.convex.cloud".to_string()),
            Some("admin-key".to_string()),
        )
        .expect("config should load");

        assert_eq!(config.convex_url, "https://example.convex.cloud");
        assert_eq!(config.convex_admin_key, "admin-key");
    }

    #[test]
    fn from_values_errors_when_either_value_is_missing_or_blank() {
        assert!(Config::from_values(None, Some("admin-key".to_string())).is_err());
        assert!(Config::from_values(Some("https://example.convex.cloud".to_string()), None).is_err());
        assert!(Config::from_values(Some("  ".to_string()), Some("admin-key".to_string())).is_err());
        assert!(Config::from_values(
            Some("https://example.convex.cloud".to_string()),
            Some("".to_string())
        )
        .is_err());
    }
}
