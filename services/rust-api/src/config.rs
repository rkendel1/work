use std::env;

pub struct Config {
    pub convex_url: String,
    pub convex_admin_key: String,
}

impl Config {
    pub fn from_env() -> Self {
        let convex_url = env::var("CONVEX_URL").expect("CONVEX_URL required");
        let convex_admin_key = env::var("CONVEX_ADMIN_KEY").expect("CONVEX_ADMIN_KEY required");

        Self {
            convex_url,
            convex_admin_key,
        }
    }
}
