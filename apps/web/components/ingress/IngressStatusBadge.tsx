type Props = {
  status: string;
};

const LABELS: Record<string, string> = {
  received: "Received",
  classified: "Classified",
  work_generated: "Work Generated",
  closed: "Closed",
};

export function IngressStatusBadge({ status }: Props) {
  return (
    <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium text-zinc-700">
      {LABELS[status] ?? status}
    </span>
  );
}
