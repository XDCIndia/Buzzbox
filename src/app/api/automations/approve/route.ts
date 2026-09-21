import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireApiEditor } from "@/lib/api-auth";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { parseAndValidate } from "@/lib/api-validate";

export const dynamic = "force-dynamic";

const LEAD_APPROVED_STATUS = "approved";

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const parsed = await parseAndValidate(
    req,
    z.object({
      id: z.string().min(1),
      type: z.enum(["content", "email"]),
      action: z.enum(["approve", "reject"]),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const { id, type, action } = parsed.data;

  const db = getDb();

  if (type === "content") {
    const newStatus = action === "approve" ? "ready" : "rejected";
    db.prepare("UPDATE content_posts SET status = ? WHERE id = ? AND status = ?")
      .run(newStatus, id, "pending_approval");
  } else if (type === "email") {
    const newStatus = action === "approve" ? "approved" : "cancelled";

    if (action === "approve") {
      const lead = db.prepare("SELECT l.status as lead_status FROM sequences s LEFT JOIN leads l ON l.id = s.lead_id WHERE s.id = ?").get(id) as { lead_status: string | null } | undefined;
      if (!lead || lead.lead_status !== LEAD_APPROVED_STATUS) {
        return NextResponse.json({ error: "Lead must be approved before email sequence approval" }, { status: 409 });
      }
    }

    db.prepare("UPDATE sequences SET status = ? WHERE id = ? AND status = ?")
      .run(newStatus, id, "pending_approval");
  }

  db.prepare("INSERT INTO activity_log (ts, action, detail, result) VALUES (datetime('now'), ?, ?, ?)")
    .run(
      action === "approve" ? "approve" : "reject",
      `${action === "approve" ? "Approved" : "Rejected"} ${type}: ${id}` ,
      action === "approve" ? "Moved to ready/approved" : "Rejected/cancelled",
    );

  logAudit({
    actor,
    action: "automation.approval",
    target: `${type}:${id}`,
    detail: { action },
  });
  return NextResponse.json({ ok: true, id, action });
}
