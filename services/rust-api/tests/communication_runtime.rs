#[path = "../src/domain/events.rs"]
mod events;

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
fn communication_runtime_stays_domain_event_driven() {
    let routes = include_str!("../src/routes.rs");
    assert!(!routes.contains("/ui/communication"));
}
