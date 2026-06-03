import { NextResponse } from "next/server";
import { RUST_INGRESS_URL } from "@/lib/runtime-config";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(request.url);
  const response = await fetch(
    `${RUST_INGRESS_URL}/executions/${encodeURIComponent(id)}?${url.searchParams.toString()}`,
    {
      cache: "no-store",
    },
  );
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
