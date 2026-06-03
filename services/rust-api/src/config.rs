use std::env;

pub struct Config {
    pub convex_url: Option<String>,
    pub convex_admin_key: Option<String>,
}

impl Config {
    pub fn load() -> Self {
        Self::from_values(env::var("CONVEX_URL").ok(), env::var("CONVEX_ADMIN_KEY").ok())
    }

    fn from_values(convex_url: Option<String>, convex_admin_key: Option<String>) -> Self {
        let convex_url = convex_url.filter(|value| !value.trim().is_empty());
        let convex_admin_key = convex_admin_key.filter(|value| !value.trim().is_empty());

        Self {
            convex_url,
            convex_admin_key,
        }
    }

    pub fn mode(&self) -> &'static str {
        if self.convex_url.is_some() && self.convex_admin_key.is_some() {
            "connected"
        } else {
            "standalone"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_values_preserves_values_when_present() {
        let config = Config::from_values(
            Some("https://example.convex.cloud".to_string()),
            Some("admin-key".to_string()),
        );

        assert_eq!(config.convex_url.as_deref(), Some("https://example.convex.cloud"));
        assert_eq!(config.convex_admin_key.as_deref(), Some("admin-key"));
        assert_eq!(config.mode(), "connected");
    }

    #[test]
    fn from_values_falls_back_to_standalone_when_either_value_is_missing_or_blank() {
        let missing_url = Config::from_values(None, Some("admin-key".to_string()));
        let missing_key = Config::from_values(Some("https://example.convex.cloud".to_string()), None);
        let blank_url = Config::from_values(Some("  ".to_string()), Some("admin-key".to_string()));
        let blank_key = Config::from_values(
            Some("https://example.convex.cloud".to_string()),
            Some("".to_string()),
        );

        assert_eq!(missing_url.mode(), "standalone");
        assert_eq!(missing_key.mode(), "standalone");
        assert_eq!(blank_url.mode(), "standalone");
        assert_eq!(blank_key.mode(), "standalone");
    }
}
