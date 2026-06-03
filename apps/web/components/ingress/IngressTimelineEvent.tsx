export type IngressTimelineEventModel = {
  type: string;
  description: string;
  created_at: number;
};

type Props = {
  event: IngressTimelineEventModel;
};

function titleForType(type: string): string {
  switch (type) {
    case "received":
      return "Received";
    case "classified":
      return "Classified";
    case "recommendations_generated":
      return "Recommendations Generated";
    case "work_generated":
      return "Work Generated";
    case "closed":
      return "Closed";
    default:
      return type;
  }
}

export function IngressTimelineEvent({ event }: Props) {
  return (
    <li className="rounded border p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <p className="font-medium">✓ {titleForType(event.type)}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {new Date(event.created_at * 1000).toLocaleString()}
      </p>
      <p className="text-zinc-700 dark:text-zinc-300">{event.description}</p>
    </li>
  );
}
