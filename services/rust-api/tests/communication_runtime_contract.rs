#[path = "../src/contracts/capability_matrix.rs"]
mod capability_matrix;
#[path = "../src/domain/events.rs"]
mod events;

use capability_matrix::RuntimeOwner;

#[test]
fn communication_runtime_domain_events_are_declared() {
    use events::DomainEvent;

    let declared = [
        DomainEvent::MessageCreated {
            tenant_id: "tenant".into(),
            message_id: "msg".into(),
        }
        .event_type(),
        DomainEvent::NotificationCreated {
            tenant_id: "tenant".into(),
            notification_id: "notif".into(),
        }
        .event_type(),
        DomainEvent::RecipientResolved {
            tenant_id: "tenant".into(),
            recipient_id: "recipient".into(),
        }
        .event_type(),
        DomainEvent::DeliveryRecorded {
            tenant_id: "tenant".into(),
            delivery_id: "delivery".into(),
        }
        .event_type(),
    ];

    assert_eq!(
        declared,
        [
            "MessageCreated",
            "NotificationCreated",
            "RecipientResolved",
            "DeliveryRecorded"
        ]
    );
}

#[test]
fn communication_runtime_ownership_is_explicit() {
    for capability in [
        "Message Creation",
        "Recipient Resolution",
        "Notification Generation",
        "Delivery Tracking",
        "Communication Policies",
        "Escalation Rules",
    ] {
        assert_eq!(
            capability_matrix::owner_for(capability),
            Some(RuntimeOwner::Rust),
            "Rust must own capability: {capability}"
        );
    }

    for capability in ["Message Views", "Inbox Queries", "Notification Read Models"] {
        assert_eq!(
            capability_matrix::owner_for(capability),
            Some(RuntimeOwner::Convex),
            "Convex must own capability: {capability}"
        );
    }
}

#[test]
fn communication_runtime_stays_domain_event_driven() {
    let routes = include_str!("../src/routes.rs");
    assert!(!routes.contains("/ui/communication"));
}
