import {
  IngressTimelineEvent,
  IngressTimelineEventModel,
} from "@/components/ingress/IngressTimelineEvent";

export type { IngressTimelineEventModel };

type Props = {
  events: IngressTimelineEventModel[];
};

export function IngressTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No processing events yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((event, index) => (
        <IngressTimelineEvent
          key={`${event.type}-${event.created_at}-${index}`}
          event={event}
        />
      ))}
    </ul>
  );
}
