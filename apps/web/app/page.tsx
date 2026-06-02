import { InboxClient, InboxItem, WorkItem } from "@/app/inbox-client";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

async function fetchInitial<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${RUST_INGRESS_URL}${path}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as T[];
  } catch {
    return [];
  }
}

export default async function Home() {
  const [initialInboxItems, initialWorkItems] = await Promise.all([
    fetchInitial<InboxItem>("/items"),
    fetchInitial<WorkItem>("/work"),
  ]);

  return (
    <InboxClient
      initialInboxItems={initialInboxItems}
      initialWorkItems={initialWorkItems}
    />
  );
}
