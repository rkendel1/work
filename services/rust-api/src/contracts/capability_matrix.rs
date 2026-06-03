#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeOwner {
    Rust,
    Convex,
    NextJs,
    Shared,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityOwnership {
    pub capability: &'static str,
    pub owner: RuntimeOwner,
}

pub const CANONFLO_CAPABILITY_MATRIX: &[CapabilityOwnership] = &[
    CapabilityOwnership {
        capability: "Signal Ingestion",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Classification",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Meaning Inference",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Business Rules",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Routing",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Work Creation",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Action Execution",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Execution State Machine",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Vault",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Secrets",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Simulation Runtime",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Communication Runtime",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Notification Dispatch",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Process Graph Generation",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Behavior Analytics",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Operational Artifact Generation",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Domain Events",
        owner: RuntimeOwner::Rust,
    },
    CapabilityOwnership {
        capability: "Read Models",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Query Surfaces",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Dashboard Materializations",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Tenant Metadata",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Historical Analytics",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Projection Storage",
        owner: RuntimeOwner::Convex,
    },
    CapabilityOwnership {
        capability: "Tenant UX",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Onboarding UX",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Admin Screens",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Visualization",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Simulation Console",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Operational Explorer",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Artifact Viewer",
        owner: RuntimeOwner::NextJs,
    },
    CapabilityOwnership {
        capability: "Authentication",
        owner: RuntimeOwner::Shared,
    },
    CapabilityOwnership {
        capability: "Tenant Context",
        owner: RuntimeOwner::Shared,
    },
    CapabilityOwnership {
        capability: "Subdomain Resolution",
        owner: RuntimeOwner::Shared,
    },
    CapabilityOwnership {
        capability: "Feature Flags",
        owner: RuntimeOwner::Shared,
    },
];

pub fn owner_for(capability: &str) -> Option<RuntimeOwner> {
    CANONFLO_CAPABILITY_MATRIX
        .iter()
        .find(|entry| entry.capability.eq_ignore_ascii_case(capability))
        .map(|entry| entry.owner)
}

pub fn render_markdown() -> String {
    let mut rust_owned = Vec::new();
    let mut convex_owned = Vec::new();
    let mut next_owned = Vec::new();
    let mut shared = Vec::new();

    for entry in CANONFLO_CAPABILITY_MATRIX {
        match entry.owner {
            RuntimeOwner::Rust => rust_owned.push(entry.capability),
            RuntimeOwner::Convex => convex_owned.push(entry.capability),
            RuntimeOwner::NextJs => next_owned.push(entry.capability),
            RuntimeOwner::Shared => shared.push(entry.capability),
        }
    }

    fn section(title: &str, capabilities: &[&str]) -> String {
        let mut out = format!("## {title}\n\n");
        for capability in capabilities {
            out.push_str("- ");
            out.push_str(capability);
            out.push('\n');
        }
        out.push('\n');
        out
    }

    let mut markdown = String::from("# CanonFlo Capability Ownership Matrix\n\n");
    markdown.push_str(
        "Generated from `services/rust-api/src/contracts/capability_matrix.rs`.\n\n",
    );
    markdown.push_str(&section("Rust Owns", &rust_owned));
    markdown.push_str(&section("Convex Owns", &convex_owned));
    markdown.push_str(&section("Next.js Owns", &next_owned));
    markdown.push_str(&section("Shared", &shared));
    markdown
}
