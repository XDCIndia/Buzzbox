import { NextRequest, NextResponse } from "next/server";
import { getSequences, updateSequenceStatus } from "@/lib/queries";
import { writebackSequenceStatus } from "@/lib/writeback";
import { requireApiEditor, requireApiUser } from "@/lib/api-auth";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { parseAndValidate } from "@/lib/api-validate";
import { z } from "zod";

const LEAD_APPROVED_STATUS = "approved";

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get("real") === "true";
  const sequences = getSequences({
    status: searchParams.get("status") || undefined,
    lead_id: searchParams.get("lead_id") || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(sequences);
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const parsed = await parseAndValidate(
    req,
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      status: z.enum(["approved", "cancelled", "queued", "sent", "pending_approval"]),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const { id, status } = parsed.data;
  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  if (status === "approved" || status === "queued" || status === "sent") {
    const db = getDb();
    const lead = db.prepare("SELECT l.status as lead_status FROM sequences s LEFT JOIN leads l ON l.id = s.lead_id WHERE s.id = ?").get(id) as { lead_status: string | null } | undefined;
    if (!lead || lead.lead_status !== LEAD_APPROVED_STATUS) {
      return NextResponse.json({ error: "Lead must be approved before outreach can be sent, queued, or approved" }, { status: 409 });
    }
  }

  updateSequenceStatus(id, status);
  writebackSequenceStatus(id, status);
  logAudit({
    actor,
    action: "sequence.update_status",
    target: "sequence:" + id,
    detail: { status },
  });

  // #85: approvals taken anywhere must reach the approvals history panel,
  // which reads activity_log ('approve'/'reject' rows) — audit_log alone
  // never shows up there.
  if (status === "approved" || status === "cancelled") {
    getDb()
      .prepare("INSERT INTO activity_log (ts, action, detail, result) VALUES (datetime('now'), ?, ?, ?)")
      .run(
        status === "approved" ? "approve" : "reject",
        `${status === "approved" ? "Approved" : "Rejected"} email: ${id}`,
        status === "approved" ? "Moved to ready/approved" : "Rejected/cancelled",
      );
  }
  return NextResponse.json({ ok: true });
}
