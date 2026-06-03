use serde::Deserialize;
use serde_json::json;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInput {
    normalized_content: Option<String>,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn process(input: &str) -> String {
    let parsed = serde_json::from_str::<ProcessInput>(input).unwrap_or_default();
    let normalized = parsed.normalized_content.unwrap_or_default();
    let content = normalized.to_lowercase();

    let (classification, priority, confidence, reason, entities, recommended_actions) =
        if content.contains("hvac") || content.contains("heat") || content.contains("cool") {
            (
                "maintenance_request",
                "high",
                0.91,
                "Detected HVAC comfort or failure pattern",
                vec!["HVAC".to_string()],
                vec![
                    json!({"title":"Dispatch HVAC technician","description":"Create an urgent HVAC service dispatch.","actionType":"dispatch"}),
                    json!({"title":"Notify site operations lead","description":"Escalate incident to on-call facilities lead.","actionType":"notify"}),
                ],
            )
        } else if content.contains("invoice")
            || content.contains("payment")
            || content.contains("billing")
        {
            (
                "finance_issue",
                "medium",
                0.86,
                "Detected billing or payment exception language",
                vec!["Finance".to_string()],
                vec![
                    json!({"title":"Create finance review task","description":"Route for accounts payable review.","actionType":"review"}),
                ],
            )
        } else {
            (
                "general_inquiry",
                "low",
                0.72,
                "No high-confidence domain pattern matched",
                Vec::<String>::new(),
                vec![json!({"title":"Triage signal","description":"Route for manual triage.","actionType":"triage"})],
            )
        };

    json!({
        "classification": classification,
        "confidence": confidence,
        "priority": priority,
        "reason": reason,
        "entities": entities,
        "summary": normalized,
        "title": format!("{} signal", classification.replace('_', " ")),
        "recommended_actions": recommended_actions,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::process;

    #[test]
    fn process_detects_hvac_patterns() {
        let result = process(r#"{"normalizedContent":"HVAC failure on floor 3"}"#);
        assert!(result.contains("\"classification\":\"maintenance_request\""));
        assert!(result.contains("\"priority\":\"high\""));
    }

    #[test]
    fn process_defaults_when_pattern_is_unknown() {
        let result = process(r#"{"normalizedContent":"General operational note"}"#);
        assert!(result.contains("\"classification\":\"general_inquiry\""));
    }
}
