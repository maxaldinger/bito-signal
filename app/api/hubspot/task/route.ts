import { NextRequest, NextResponse } from "next/server";
import { hubspotCreateTask, type HsKind, type HsTaskType } from "@/lib/hubspot";
import { apolloPersonContact } from "@/lib/enrich/apollo";

// POST /api/hubspot/task
// body: {
//   kind, subject, body, dueDateMs, taskType?, objectId?,
//   // company task: name (company), domain
//   // contact task: name (contact), email?, phone?, jobtitle?, apolloId?,
//   //               companyName?, companyDomain?
// }
// Creates a HubSpot task with a fully-populated record behind it. For a contact,
// any missing email/phone is revealed from Apollo (by apolloId) so the CRM
// contact lands complete.
export const maxDuration = 30;

const TASK_TYPES = new Set(["CALL", "EMAIL", "TODO"]);

export async function POST(req: NextRequest) {
  let body: {
    kind?: string;
    name?: string;
    domain?: string;
    email?: string;
    phone?: string;
    jobtitle?: string;
    apolloId?: string;
    companyName?: string;
    companyDomain?: string;
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

  // Complete the contact: reveal any missing email/phone from Apollo so the
  // HubSpot record gets real contact info (best-effort — never blocks the task).
  let email = body.email;
  let phone = body.phone;
  if (body.kind === "contact" && body.apolloId) {
    if (!email) {
      const r = await apolloPersonContact({ id: body.apolloId, reveal: "email" });
      if (r.ok && r.email) email = r.email;
    }
    if (!phone) {
      const r = await apolloPersonContact({ id: body.apolloId, reveal: "phone" });
      if (r.ok && r.phone) phone = r.phone;
    }
  }

  // Only use a COMPANY-domain email. A personal/off-domain one (Apollo often
  // returns these) would mis-associate the contact, so drop it — the push then
  // proceeds as a LinkedIn-connect task with no email rather than being blocked.
  if (body.kind === "contact" && email && body.companyDomain) {
    const root = (d?: string) => {
      if (!d) return "";
      const p = d.toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
      return p.length <= 2 ? p.join(".") : p.slice(-2).join(".");
    };
    if (root(email.split("@")[1]) !== root(body.companyDomain)) email = undefined;
  }

  const result = await hubspotCreateTask({
    kind: body.kind as HsKind,
    objectId: body.objectId,
    name: body.name,
    domain: body.domain,
    email,
    phone,
    jobtitle: body.jobtitle,
    companyName: body.companyName,
    companyDomain: body.companyDomain,
    subject: body.subject,
    body: body.body ?? "",
    dueDateMs: body.dueDateMs,
    taskType,
  });
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, { status });
}
