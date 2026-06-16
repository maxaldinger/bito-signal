import { NextRequest, NextResponse } from "next/server";
import { hubspotCreateTask, type HsKind, type HsTaskType } from "@/lib/hubspot";

// POST /api/hubspot/task
// body: { kind, name?, domain?, email?, objectId?, subject, body, dueDateMs, taskType? }
// Creates a HubSpot task linked to the company/contact (resolving or creating
// the record so the task is never orphaned).
export const maxDuration = 25;

const TASK_TYPES = new Set(["CALL", "EMAIL", "TODO"]);

export async function POST(req: NextRequest) {
  let body: {
    kind?: string;
    name?: string;
    domain?: string;
    email?: string;
    objectId?: string;
    subject?: string;
    body?: string;
    dueDateMs?: number;
    taskType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.kind !== "company" && body.kind !== "contact") {
    return NextResponse.json({ error: "kind must be 'company' or 'contact'" }, { status: 400 });
  }
  if (!body.subject?.trim()) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (typeof body.dueDateMs !== "number" || !Number.isFinite(body.dueDateMs)) {
    return NextResponse.json({ error: "dueDateMs (epoch ms) is required" }, { status: 400 });
  }
  const taskType =
    body.taskType && TASK_TYPES.has(body.taskType) ? (body.taskType as HsTaskType) : "CALL";

  const result = await hubspotCreateTask({
    kind: body.kind as HsKind,
    objectId: body.objectId,
    name: body.name,
    domain: body.domain,
    email: body.email,
    subject: body.subject,
    body: body.body ?? "",
    dueDateMs: body.dueDateMs,
    taskType,
  });
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, { status });
}
