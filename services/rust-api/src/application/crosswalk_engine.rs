use super::super::domain::{crosswalk::OperationalCrosswalk, events::DomainEvent};

#[derive(Debug, Clone, Default)]
pub struct OperationalMeaning {
    pub category: Option<String>,
    pub confidence: f32,
}

impl OperationalMeaning {
    pub fn empty() -> Self {
        Self::default()
    }
}

pub struct CrosswalkEngine {
    crosswalk: OperationalCrosswalk,
}

impl CrosswalkEngine {
    pub fn from(crosswalk: OperationalCrosswalk) -> Self {
        Self { crosswalk }
    }

    pub fn interpret(&self, event: &DomainEvent) -> OperationalMeaning {
        match event {
            DomainEvent::SignalReceived { content, .. } => self.map_signal(content),
            _ => OperationalMeaning::empty(),
        }
    }

    fn map_signal(&self, content: &str) -> OperationalMeaning {
        let content_lc = content.to_ascii_lowercase();
        let matched = self
            .crosswalk
            .canonical_terms
            .iter()
            .find(|mapping| content_lc.contains(&mapping.source_term.to_ascii_lowercase()));
        OperationalMeaning {
            category: matched.map(|mapping| mapping.canonical_type.clone()),
            confidence: matched.map(|mapping| mapping.confidence).unwrap_or(0.2),
        }
    }
}
