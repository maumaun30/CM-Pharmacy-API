const { and, eq, desc, asc, gte, lte, lt, isNull, inArray, sql } = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const dayjs = require("dayjs");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { dbErrorMessage } = require("../utils/dbError");
const { distanceMeters, normalizeBssid } = require("../utils/geo");
const { emitTimeClock, emitTimeEntryUpdated, emitDashboardRefresh } = require("../utils/socket");

const {
  users,
  branches,
  logs,
  timeEntries,
  branchClockRules,
  branchAccessPoints,
  branchPayRules,
  shiftSchedules,
  coverageRequirements,
} = schema;

// ─────────────────────────────────────────────────────────────────────────────
// Employee time tracking.
//
// Two clients, one table: the mobile app produces clock events (staff and
// managers clock themselves in), the web console supervises and approves them.
//
// The presence check is enforced HERE, not on the device. The client's own
// Wi-Fi/geo check is UX — it fails fast and explains itself — but a phone can
// lie about both, so every clock-in re-runs the branch rules against the
// evidence it submitted and records the verdict. A failed check does not block
// the clock-in outright: it stores the shift flagged, so nobody loses paid time
// over a router swap, and a supervisor decides.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Projection ──────────────────────────────────────────────────────────────
// Raw columns go back snake_case (the casing rule in docs/local-dev.md);
// derived/joined values use camelCase aliases.

const toSnake = (row) => ({
  id: row.id,
  user_id: row.userId,
  branch_id: row.branchId,
  clock_in_at: row.clockInAt,
  clock_out_at: row.clockOutAt,
  break_minutes: row.breakMinutes,
  break_started_at: row.breakStartedAt,
  status: row.status,
  source: row.source,
  verified: row.verified,
  flag_reason: row.flagReason,
  evidence: row.evidence,
  auto_closed: row.autoClosed,
  approved_by: row.approvedBy,
  approved_at: row.approvedAt,
  edited_by: row.editedBy,
  edited_at: row.editedAt,
  edit_reason: row.editReason,
  note: row.note,
  client_ref: row.clientRef,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const displayName = (row) =>
  row?.firstName || row?.lastName
    ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
    : row?.username ?? "Unknown";

/**
 * Minutes actually worked. Counts an open shift up to now, and subtracts the
 * break currently in progress as well as the accumulated total — otherwise a
 * running timer keeps climbing while someone is at lunch.
 */
const WORKED_MINUTES_SQL = sql`
  greatest(
    0,
    extract(epoch from (coalesce(${timeEntries.clockOutAt}, now()) - ${timeEntries.clockInAt})) / 60
      - ${timeEntries.breakMinutes}
      - coalesce(extract(epoch from (now() - ${timeEntries.breakStartedAt})) / 60, 0)
  )
`;

const workedMinutes = (entry, now = Date.now()) => {
  const end = entry.clock_out_at ? new Date(entry.clock_out_at).getTime() : now;
  const gross = (end - new Date(entry.clock_in_at).getTime()) / 60000;
  const liveBreak = entry.break_started_at
    ? (now - new Date(entry.break_started_at).getTime()) / 60000
    : 0;
  return Math.max(0, Math.round(gross - entry.break_minutes - liveBreak));
};

// ─── Scope helpers ───────────────────────────────────────────────────────────

/**
 * Which branch is this request about?
 *
 * Mirrors the workspace's multi-branch rule: an admin with no current_branch_id
 * is viewing ALL branches (null), everyone else is pinned to their active
 * branch. An explicit ?branchId is honoured only for users who may cross
 * branches — a manager asking for someone else's branch gets their own.
 */
const resolveBranchScope = (req) => {
  const isAdminTier = req.user.role === "admin" || req.user.role === "superadmin";
  const requested = req.query.branchId ? Number(req.query.branchId) : null;

  if (isAdminTier) {
    if (requested) return requested;
    return req.user.currentBranchId ?? null; // null = every branch
  }

  const own = req.user.currentBranchId || req.user.branchId;
  if (requested && requested !== own && !(req.user.allowedBranchIds ?? []).includes(requested)) {
    return own;
  }
  return requested || own;
};

const has = (req, permission) => (req.user.permissions ?? []).includes(permission);

/** Period filter shared by the console's segmented control. */
const periodRange = (period) => {
  const now = dayjs();
  switch (period) {
    case "last-week":
      return { from: now.subtract(1, "week").startOf("week"), to: now.subtract(1, "week").endOf("week") };
    case "pay-period":
      // Cut-off is the 25th: the period runs 26th → 25th.
      return now.date() > 25
        ? { from: now.date(26).startOf("day"), to: now.add(1, "month").date(25).endOf("day") }
        : { from: now.subtract(1, "month").date(26).startOf("day"), to: now.date(25).endOf("day") };
    case "this-week":
    default:
      return { from: now.startOf("week"), to: now.endOf("week") };
  }
};

// ─── Presence check ──────────────────────────────────────────────────────────

/**
 * Re-run the branch's clock-in rules server-side against submitted evidence.
 * Returns the verdict plus a human-readable reason the client can show.
 *
 * A rule that cannot be evaluated (Wi-Fi lock on but no access points
 * configured; geo lock on but the branch has no coordinates) fails OPEN with a
 * flag rather than locking a branch out of clocking in entirely.
 */
async function evaluatePresence(branchId, evidence = {}) {
  const [rules] = await db
    .select()
    .from(branchClockRules)
    .where(eq(branchClockRules.branchId, branchId))
    .limit(1);

  if (!rules) {
    return { verified: true, flagReason: null, checks: { wifi: "skipped", geo: "skipped" } };
  }

  const checks = { wifi: "skipped", geo: "skipped" };
  const reasons = [];

  if (rules.wifiLock) {
    const aps = await db
      .select()
      .from(branchAccessPoints)
      .where(eq(branchAccessPoints.branchId, branchId));

    const allowed = aps.filter((ap) => ap.isAllowed).map((ap) => normalizeBssid(ap.bssid));
    const observed = normalizeBssid(evidence.bssid);

    if (allowed.length === 0) {
      checks.wifi = "unconfigured";
      reasons.push("Wi-Fi lock is on but no access points are approved for this branch");
    } else if (!observed) {
      checks.wifi = "failed";
      reasons.push("No Wi-Fi network details were reported by the device");
    } else if (allowed.includes(observed)) {
      checks.wifi = "passed";
    } else {
      checks.wifi = "failed";
      const known = aps.find((ap) => normalizeBssid(ap.bssid) === observed);
      reasons.push(
        known
          ? `Connected to ${known.ssid}, which is not approved for clocking in`
          : `Connected to an unrecognised network (${evidence.ssid || observed})`
      );
    }
  }

  if (rules.geoLock) {
    if (rules.latitude === null || rules.longitude === null) {
      checks.geo = "unconfigured";
      reasons.push("Location check is on but the branch has no coordinates set");
    } else {
      const distance = distanceMeters(evidence.latitude, evidence.longitude, rules.latitude, rules.longitude);
      if (distance === null) {
        checks.geo = "failed";
        reasons.push("No location was reported by the device");
      } else if (distance <= rules.geoRadiusM) {
        checks.geo = "passed";
        checks.distanceM = distance;
      } else {
        checks.geo = "failed";
        checks.distanceM = distance;
        reasons.push(`${distance} m from the branch (limit ${rules.geoRadiusM} m)`);
      }
    }
  }

  return {
    verified: reasons.length === 0,
    flagReason: reasons.length ? reasons.join("; ") : null,
    checks,
    rules,
  };
}

// ─── Late detection ──────────────────────────────────────────────────────────

/**
 * Match entries to the roster and mark the ones that started late. "Late" is
 * derived, never stored — editing a roster should change the verdict, and a
 * stored flag would go stale.
 */
async function lateMap(entries, graceMinutesByBranch) {
  if (entries.length === 0) return new Map();

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const earliest = entries.reduce(
    (min, e) => (new Date(e.clock_in_at) < min ? new Date(e.clock_in_at) : min),
    new Date(entries[0].clock_in_at)
  );

  const shifts = await db
    .select()
    .from(shiftSchedules)
    .where(
      and(
        inArray(shiftSchedules.userId, userIds),
        gte(shiftSchedules.startsAt, dayjs(earliest).subtract(1, "day").toISOString())
      )
    );

  const out = new Map();
  for (const entry of entries) {
    const clockIn = dayjs(entry.clock_in_at);
    // The roster slot for that person on that calendar day.
    const shift = shifts.find(
      (s) => s.userId === entry.user_id && dayjs(s.startsAt).isSame(clockIn, "day")
    );
    if (!shift) continue;

    const grace = graceMinutesByBranch.get(entry.branch_id) ?? 15;
    const lateBy = clockIn.diff(dayjs(shift.startsAt), "minute");
    if (lateBy > grace) {
      out.set(entry.id, { lateMinutes: lateBy, scheduledStart: shift.startsAt });
    }
  }
  return out;
}

/** Grace minutes per branch, for late detection. */
async function graceByBranch() {
  const rows = await db
    .select({ branchId: branchClockRules.branchId, grace: branchClockRules.lateGraceMinutes })
    .from(branchClockRules);
  return new Map(rows.map((r) => [r.branchId, r.grace]));
}

/**
 * The status the clients render, which is richer than the stored lifecycle:
 * Open / Late are derived, Approved / Pending are stored.
 */
const presentStatus = (entry, late) => {
  if (entry.status === "approved") return "approved";
  if (!entry.clock_out_at) return late ? "late" : "open";
  return "pending";
};

// ── GET /api/time/current ────────────────────────────────────────────────────
// The signed-in user's open shift, for the mobile app to rehydrate on launch.
exports.getCurrent = async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user.id), isNull(timeEntries.clockOutAt)))
      .limit(1);

    if (!row) return res.json({ entry: null });

    const entry = toSnake(row);
    return res.json({
      entry: {
        ...entry,
        workedMinutes: workedMinutes(entry),
        onBreak: !!entry.break_started_at,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── POST /api/time/clock-in ──────────────────────────────────────────────────
exports.clockIn = async (req, res) => {
  try {
    const { ssid, bssid, latitude, longitude, accuracyM, clientRef, clockInAt } = req.body;
    const branchId = req.user.currentBranchId || req.user.branchId;

    if (!branchId) {
      return res.status(400).json({ message: "You are not assigned to any branch" });
    }

    // Offline replay: the mobile outbox may deliver the same event twice. The
    // unique index enforces this too; checking first returns the original row
    // instead of a 500.
    if (clientRef) {
      const [existing] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.clientRef, clientRef))
        .limit(1);
      if (existing) return res.status(200).json({ entry: toSnake(existing), duplicate: true });
    }

    const [open] = await db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user.id), isNull(timeEntries.clockOutAt)))
      .limit(1);
    if (open) {
      return res.status(409).json({ message: "You already have a shift running", entryId: open.id });
    }

    const verdict = await evaluatePresence(branchId, { ssid, bssid, latitude, longitude });

    const [inserted] = await db
      .insert(timeEntries)
      .values({
        userId: req.user.id,
        branchId,
        // A queued offline event carries the time it actually happened.
        clockInAt: clockInAt ? new Date(clockInAt).toISOString() : new Date().toISOString(),
        status: "open",
        source: req.body.source === "console" ? "console" : "mobile",
        verified: verdict.verified,
        flagReason: verdict.flagReason,
        evidence: { ssid: ssid ?? null, bssid: bssid ?? null, latitude: latitude ?? null, longitude: longitude ?? null, accuracyM: accuracyM ?? null, checks: verdict.checks },
        clientRef: clientRef ?? null,
      })
      .returning();

    const entry = toSnake(inserted);

    await createLog(
      req,
      "CREATE",
      "time_entries",
      entry.id,
      verdict.verified
        ? `Clocked in at ${dayjs(entry.clock_in_at).format("HH:mm")}`
        : `Clocked in at ${dayjs(entry.clock_in_at).format("HH:mm")} — flagged: ${verdict.flagReason}`,
      { branchId, verified: verdict.verified, checks: verdict.checks, ssid: ssid ?? null, bssid: bssid ?? null }
    );

    emitTimeClock(branchId, { action: "clock-in", entry });

    return res.status(201).json({ entry, verified: verdict.verified, flagReason: verdict.flagReason, checks: verdict.checks });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── POST /api/time/clock-out ─────────────────────────────────────────────────
// Deliberately skips the presence check: never trap someone at the end of a
// shift because the Wi-Fi dropped.
exports.clockOut = async (req, res) => {
  try {
    const { clockOutAt, note } = req.body;

    const [open] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user.id), isNull(timeEntries.clockOutAt)))
      .limit(1);

    if (!open) return res.status(404).json({ message: "No shift is currently running" });

    const endedAt = clockOutAt ? new Date(clockOutAt) : new Date();
    if (endedAt <= new Date(open.clockInAt)) {
      return res.status(400).json({ message: "Clock-out must be after clock-in" });
    }

    // Close an in-progress break so its minutes are not lost.
    const breakMinutes = open.breakStartedAt
      ? open.breakMinutes + Math.max(0, Math.round((endedAt - new Date(open.breakStartedAt)) / 60000))
      : open.breakMinutes;

    const [updated] = await db
      .update(timeEntries)
      .set({
        clockOutAt: endedAt.toISOString(),
        breakMinutes,
        breakStartedAt: null,
        // Every completed shift awaits a supervisor's approval.
        status: "pending",
        note: note ?? open.note,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(timeEntries.id, open.id))
      .returning();

    const entry = toSnake(updated);

    await createLog(
      req,
      "UPDATE",
      "time_entries",
      entry.id,
      `Clocked out at ${dayjs(entry.clock_out_at).format("HH:mm")} (${workedMinutes(entry)} min worked)`,
      { branchId: entry.branch_id, breakMinutes }
    );

    emitTimeClock(entry.branch_id, { action: "clock-out", entry });

    return res.json({ entry: { ...entry, workedMinutes: workedMinutes(entry) } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── POST /api/time/break ─────────────────────────────────────────────────────
exports.toggleBreak = async (req, res) => {
  try {
    const { action } = req.body; // "start" | "end"
    if (!["start", "end"].includes(action)) {
      return res.status(400).json({ message: "action must be 'start' or 'end'" });
    }

    const [open] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, req.user.id), isNull(timeEntries.clockOutAt)))
      .limit(1);

    if (!open) return res.status(404).json({ message: "No shift is currently running" });

    if (action === "start") {
      if (open.breakStartedAt) return res.status(409).json({ message: "Already on break" });
      const [updated] = await db
        .update(timeEntries)
        .set({ breakStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(timeEntries.id, open.id))
        .returning();
      const entry = toSnake(updated);
      emitTimeClock(entry.branch_id, { action: "break-start", entry });
      return res.json({ entry });
    }

    if (!open.breakStartedAt) return res.status(409).json({ message: "Not on break" });
    const minutes = Math.max(0, Math.round((Date.now() - new Date(open.breakStartedAt)) / 60000));
    const [updated] = await db
      .update(timeEntries)
      .set({
        breakMinutes: open.breakMinutes + minutes,
        breakStartedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(timeEntries.id, open.id))
      .returning();

    const entry = toSnake(updated);
    emitTimeClock(entry.branch_id, { action: "break-end", entry });
    return res.json({ entry });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/time/entries ────────────────────────────────────────────────────
// The console's table and the mobile app's own-hours list share this endpoint;
// scope is decided by capability, not by a query flag the client could forge.
exports.listEntries = async (req, res) => {
  try {
    const { period = "this-week", status = "all" } = req.query;
    const canViewAll = has(req, "time.view_all");
    const branchScope = resolveBranchScope(req);
    const { from, to } = periodRange(period);

    const filters = [
      gte(timeEntries.clockInAt, from.toISOString()),
      lte(timeEntries.clockInAt, to.toISOString()),
    ];

    if (!canViewAll) {
      filters.push(eq(timeEntries.userId, req.user.id));
    } else {
      if (branchScope) filters.push(eq(timeEntries.branchId, branchScope));
      if (req.query.userId) filters.push(eq(timeEntries.userId, Number(req.query.userId)));
    }

    const approver = alias(users, "approver");

    const rows = await db
      .select({
        entry: timeEntries,
        staffFirstName: users.firstName,
        staffLastName: users.lastName,
        staffUsername: users.username,
        staffRole: users.role,
        branchName: branches.name,
        approverFirstName: approver.firstName,
        approverLastName: approver.lastName,
        approverUsername: approver.username,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(branches, eq(timeEntries.branchId, branches.id))
      .leftJoin(approver, eq(timeEntries.approvedBy, approver.id))
      .where(and(...filters))
      .orderBy(desc(timeEntries.clockInAt));

    const entries = rows.map((r) => toSnake(r.entry));
    const late = await lateMap(entries, await graceByBranch());

    let shaped = rows.map((r, i) => {
      const entry = entries[i];
      const lateInfo = late.get(entry.id);
      return {
        ...entry,
        workedMinutes: workedMinutes(entry),
        displayStatus: presentStatus(entry, !!lateInfo),
        lateMinutes: lateInfo?.lateMinutes ?? null,
        scheduledStart: lateInfo?.scheduledStart ?? null,
        edited: !!entry.edited_by,
        staffName: displayName({ firstName: r.staffFirstName, lastName: r.staffLastName, username: r.staffUsername }),
        staffRole: r.staffRole,
        branchName: r.branchName,
        approvedByName: r.approverUsername
          ? displayName({ firstName: r.approverFirstName, lastName: r.approverLastName, username: r.approverUsername })
          : null,
      };
    });

    // Status filter runs on the DERIVED status, which is what the console's
    // segmented control actually shows.
    if (status === "needs-action") {
      shaped = shaped.filter((e) => e.displayStatus === "pending" || e.displayStatus === "late");
    } else if (status !== "all") {
      shaped = shaped.filter((e) => e.displayStatus === status);
    }

    const totalMinutes = shaped.reduce((sum, e) => sum + e.workedMinutes, 0);

    return res.json({
      entries: shaped,
      total_minutes: totalMinutes,
      count: shaped.length,
      period,
      branch_id: branchScope,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── POST /api/time/entries/approve ───────────────────────────────────────────
// Bulk and single approval share this. Approving is idempotent.
exports.approveEntries = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ message: "No entries given" });

    const branchScope = resolveBranchScope(req);

    const filters = [inArray(timeEntries.id, ids)];
    // A manager may only approve their own branch's entries.
    if (branchScope) filters.push(eq(timeEntries.branchId, branchScope));

    const found = await db.select().from(timeEntries).where(and(...filters));
    if (found.length === 0) {
      return res.status(404).json({ message: "No matching entries you may approve" });
    }

    const open = found.filter((e) => !e.clockOutAt);
    if (open.length > 0) {
      return res.status(409).json({
        message: "A running shift cannot be approved — it has no end time yet",
        entryIds: open.map((e) => e.id),
      });
    }

    const approvable = found.filter((e) => e.status !== "approved").map((e) => e.id);
    if (approvable.length === 0) {
      return res.json({ entries: found.map(toSnake), approved: 0 });
    }

    const now = new Date().toISOString();
    const updated = await db
      .update(timeEntries)
      .set({ status: "approved", approvedBy: req.user.id, approvedAt: now, updatedAt: now })
      .where(inArray(timeEntries.id, approvable))
      .returning();

    const entries = updated.map(toSnake);

    for (const entry of entries) {
      await createLog(
        req,
        "UPDATE",
        "time_entries",
        entry.id,
        `Approved timesheet entry for ${dayjs(entry.clock_in_at).format("D MMM")} (${workedMinutes(entry)} min)`,
        { branchId: entry.branch_id, userId: entry.user_id, bulk: approvable.length > 1 }
      );
    }

    const branchId = entries[0]?.branch_id;
    emitTimeEntryUpdated(branchId, { action: "approved", entries });
    emitDashboardRefresh(branchId);

    return res.json({ entries, approved: entries.length });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/time/entries/:id ────────────────────────────────────────────────
// Correct a clock time. A reason is mandatory: the audit trail is the whole
// point of letting a supervisor rewrite someone's hours.
exports.updateEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { clockInAt, clockOutAt, breakMinutes, reason, note } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "A reason is required when editing times" });
    }

    const branchScope = resolveBranchScope(req);
    const filters = [eq(timeEntries.id, Number(id))];
    if (branchScope) filters.push(eq(timeEntries.branchId, branchScope));

    const [existing] = await db.select().from(timeEntries).where(and(...filters)).limit(1);
    if (!existing) return res.status(404).json({ message: "Entry not found" });

    const nextIn = clockInAt ? new Date(clockInAt).toISOString() : existing.clockInAt;
    const nextOut = clockOutAt === null
      ? null
      : clockOutAt
        ? new Date(clockOutAt).toISOString()
        : existing.clockOutAt;

    if (nextOut && new Date(nextOut) <= new Date(nextIn)) {
      return res.status(400).json({ message: "Clock-out must be after clock-in" });
    }

    const now = new Date().toISOString();
    const [updated] = await db
      .update(timeEntries)
      .set({
        clockInAt: nextIn,
        clockOutAt: nextOut,
        breakMinutes: breakMinutes ?? existing.breakMinutes,
        note: note ?? existing.note,
        // An edited entry returns to pending: the edit itself needs signing off.
        status: nextOut ? "pending" : "open",
        approvedBy: null,
        approvedAt: null,
        editedBy: req.user.id,
        editedAt: now,
        editReason: reason,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, existing.id))
      .returning();

    const entry = toSnake(updated);

    // before → after, so the audit log can answer "what did it used to say?"
    await createLog(
      req,
      "UPDATE",
      "time_entries",
      entry.id,
      `Edited times: ${dayjs(existing.clockInAt).format("HH:mm")} → ${dayjs(entry.clock_in_at).format("HH:mm")} in, ${
        existing.clockOutAt ? dayjs(existing.clockOutAt).format("HH:mm") : "—"
      } → ${entry.clock_out_at ? dayjs(entry.clock_out_at).format("HH:mm") : "—"} out · reason: ${reason}`,
      {
        branchId: entry.branch_id,
        userId: entry.user_id,
        before: { clockInAt: existing.clockInAt, clockOutAt: existing.clockOutAt, breakMinutes: existing.breakMinutes },
        after: { clockInAt: entry.clock_in_at, clockOutAt: entry.clock_out_at, breakMinutes: entry.break_minutes },
        reason,
      }
    );

    emitTimeEntryUpdated(entry.branch_id, { action: "edited", entries: [entry] });

    return res.json({ entry: { ...entry, workedMinutes: workedMinutes(entry) } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/time/on-shift ───────────────────────────────────────────────────
exports.getOnShift = async (req, res) => {
  try {
    const branchScope = resolveBranchScope(req);
    const filters = [isNull(timeEntries.clockOutAt)];
    if (branchScope) filters.push(eq(timeEntries.branchId, branchScope));

    const rows = await db
      .select({
        entry: timeEntries,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        role: users.role,
        branchName: branches.name,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(branches, eq(timeEntries.branchId, branches.id))
      .where(and(...filters))
      .orderBy(asc(timeEntries.clockInAt));

    const entries = rows.map((r) => toSnake(r.entry));
    const late = await lateMap(entries, await graceByBranch());

    const people = rows.map((r, i) => {
      const entry = entries[i];
      const lateInfo = late.get(entry.id);
      return {
        entry_id: entry.id,
        user_id: entry.user_id,
        branch_id: entry.branch_id,
        clock_in_at: entry.clock_in_at,
        name: displayName(r),
        role: r.role,
        branchName: r.branchName,
        workedMinutes: workedMinutes(entry),
        onBreak: !!entry.break_started_at,
        lateMinutes: lateInfo?.lateMinutes ?? null,
        verified: entry.verified,
      };
    });

    // "6 of 9": how many are rostered anywhere today, for the headline count.
    const rosterFilters = [
      gte(shiftSchedules.startsAt, dayjs().startOf("day").toISOString()),
      lte(shiftSchedules.startsAt, dayjs().endOf("day").toISOString()),
    ];
    if (branchScope) rosterFilters.push(eq(shiftSchedules.branchId, branchScope));
    const [{ n: rosteredToday }] = await db
      .select({ n: sql`count(*)::int` })
      .from(shiftSchedules)
      .where(and(...rosterFilters));

    return res.json({ people, on_shift: people.length, rostered_today: rosteredToday });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/time/overview ───────────────────────────────────────────────────
// Everything the console's Overview page needs, in one round trip.
exports.getOverview = async (req, res) => {
  try {
    const branchScope = resolveBranchScope(req);
    const weekStart = dayjs().startOf("week");
    const weekEnd = dayjs().endOf("week");

    const scoped = (extra = []) =>
      and(...(branchScope ? [eq(timeEntries.branchId, branchScope), ...extra] : extra));

    // Hours worked this week, and the same figure per day for the bar chart.
    const weekRows = await db
      .select({
        day: sql`date_trunc('day', ${timeEntries.clockInAt})`.as("day"),
        minutes: sql`sum(${WORKED_MINUTES_SQL})::float`.as("minutes"),
      })
      .from(timeEntries)
      .where(
        scoped([
          gte(timeEntries.clockInAt, weekStart.toISOString()),
          lte(timeEntries.clockInAt, weekEnd.toISOString()),
        ])
      )
      .groupBy(sql`date_trunc('day', ${timeEntries.clockInAt})`);

    const byDay = new Map(weekRows.map((r) => [dayjs(r.day).format("YYYY-MM-DD"), r.minutes ?? 0]));
    const weekChart = Array.from({ length: 7 }, (_, i) => {
      const d = weekStart.add(i, "day");
      const minutes = byDay.get(d.format("YYYY-MM-DD")) ?? 0;
      return {
        date: d.format("YYYY-MM-DD"),
        dow: d.format("ddd"),
        minutes: Math.round(minutes),
        hours: Math.round(minutes / 60),
        isToday: d.isSame(dayjs(), "day"),
      };
    });

    const weekMinutes = weekChart.reduce((sum, d) => sum + d.minutes, 0);

    // Labour cost needs an hourly rate; without one the console shows a head
    // count instead, so return null rather than a misleading zero.
    const payFilters = branchScope ? [eq(branchPayRules.branchId, branchScope)] : [];
    const payRules = await db.select().from(branchPayRules).where(and(...payFilters));
    const rate = payRules.find((p) => p.hourlyRate !== null)?.hourlyRate ?? null;
    const normalWeekHours = payRules[0]?.normalWeekHours ?? 45;

    const [{ n: pendingApprovals }] = await db
      .select({ n: sql`count(*)::int` })
      .from(timeEntries)
      .where(scoped([eq(timeEntries.status, "pending")]));

    const [{ n: flagged }] = await db
      .select({ n: sql`count(*)::int` })
      .from(timeEntries)
      .where(
        scoped([
          eq(timeEntries.verified, false),
          gte(timeEntries.clockInAt, weekStart.subtract(1, "week").toISOString()),
        ])
      );

    // Overtime = whatever each person worked beyond the normal week.
    const perStaff = await db
      .select({
        userId: timeEntries.userId,
        minutes: sql`sum(${WORKED_MINUTES_SQL})::float`.as("minutes"),
      })
      .from(timeEntries)
      .where(
        scoped([
          gte(timeEntries.clockInAt, weekStart.toISOString()),
          lte(timeEntries.clockInAt, weekEnd.toISOString()),
        ])
      )
      .groupBy(timeEntries.userId);

    const overtimeMinutes = perStaff.reduce(
      (sum, s) => sum + Math.max(0, (s.minutes ?? 0) - normalWeekHours * 60),
      0
    );

    // Exceptions worth a supervisor's attention.
    const attention = [];

    const lateToday = await db
      .select({ entry: timeEntries, firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(scoped([gte(timeEntries.clockInAt, dayjs().startOf("day").toISOString())]));

    const lateEntries = await lateMap(lateToday.map((r) => toSnake(r.entry)), await graceByBranch());
    if (lateEntries.size > 0) {
      const names = lateToday
        .filter((r) => lateEntries.has(Number(r.entry.id)))
        .map((r) => `${displayName(r)} ${dayjs(r.entry.clockInAt).format("HH:mm")}`);
      attention.push({
        kind: "late",
        title: `${lateEntries.size} late start${lateEntries.size > 1 ? "s" : ""} today`,
        detail: names.join(" · "),
      });
    }

    const autoClosed = await db
      .select({ entry: timeEntries, firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(scoped([eq(timeEntries.autoClosed, true), eq(timeEntries.status, "pending")]));
    if (autoClosed.length > 0) {
      attention.push({
        kind: "missed-clock-out",
        title: `${autoClosed.length} missed clock-out${autoClosed.length > 1 ? "s" : ""}`,
        detail: autoClosed
          .map((r) => `${displayName(r)}, ${dayjs(r.entry.clockInAt).format("ddd D MMM")} — auto-closed`)
          .join(" · "),
      });
    }

    const offNetwork = await db
      .select({ entry: timeEntries, firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(scoped([eq(timeEntries.verified, false), eq(timeEntries.status, "pending")]));
    if (offNetwork.length > 0) {
      attention.push({
        kind: "off-network",
        title: `${offNetwork.length} off-network clock-in${offNetwork.length > 1 ? "s" : ""}`,
        detail: offNetwork
          .map((r) => `${displayName(r)}, ${dayjs(r.entry.clockInAt).format("ddd D MMM")} — ${r.entry.flagReason ?? "flagged"}`)
          .join(" · "),
      });
    }

    const onShiftFilters = [isNull(timeEntries.clockOutAt)];
    if (branchScope) onShiftFilters.push(eq(timeEntries.branchId, branchScope));
    const [{ n: onShiftNow }] = await db
      .select({ n: sql`count(*)::int` })
      .from(timeEntries)
      .where(and(...onShiftFilters));

    const rosterFilters = [
      gte(shiftSchedules.startsAt, dayjs().startOf("day").toISOString()),
      lte(shiftSchedules.startsAt, dayjs().endOf("day").toISOString()),
    ];
    if (branchScope) rosterFilters.push(eq(shiftSchedules.branchId, branchScope));
    const [{ n: rosteredToday }] = await db
      .select({ n: sql`count(*)::int` })
      .from(shiftSchedules)
      .where(and(...rosterFilters));

    return res.json({
      kpis: {
        on_shift_now: onShiftNow,
        rostered_today: rosteredToday,
        week_minutes: weekMinutes,
        labour_cost: rate === null ? null : Math.round((weekMinutes / 60) * rate * 100) / 100,
        pending_approvals: pendingApprovals,
        overtime_minutes: Math.round(overtimeMinutes),
        exceptions: flagged,
      },
      week_chart: weekChart,
      attention,
      coverage_gaps: await coverageGaps(branchScope),
      branch_id: branchScope,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

/**
 * Coverage gaps for the next 7 days: a required window with fewer people
 * rostered than it needs. Unstaffed (nobody at all) vs short (some, not enough)
 * drives the red/amber split in the console.
 */
async function coverageGaps(branchScope) {
  const reqFilters = branchScope ? [eq(coverageRequirements.branchId, branchScope)] : [];
  const requirements = await db
    .select({ req: coverageRequirements, branchName: branches.name })
    .from(coverageRequirements)
    .leftJoin(branches, eq(coverageRequirements.branchId, branches.id))
    .where(and(...reqFilters));

  if (requirements.length === 0) return [];

  const horizonStart = dayjs().startOf("day");
  const horizonEnd = horizonStart.add(7, "day");

  const rosterFilters = [
    gte(shiftSchedules.startsAt, horizonStart.toISOString()),
    lt(shiftSchedules.startsAt, horizonEnd.toISOString()),
  ];
  if (branchScope) rosterFilters.push(eq(shiftSchedules.branchId, branchScope));
  const roster = await db.select().from(shiftSchedules).where(and(...rosterFilters));

  const gaps = [];
  for (let i = 0; i < 7; i += 1) {
    const day = horizonStart.add(i, "day");
    for (const { req, branchName } of requirements) {
      if (req.weekday !== day.day()) continue;

      const windowStart = dayjs(`${day.format("YYYY-MM-DD")}T${req.startTime}`);
      const windowEnd = dayjs(`${day.format("YYYY-MM-DD")}T${req.endTime}`);

      // Anyone whose rostered shift overlaps the window covers it.
      const covering = roster.filter(
        (s) =>
          s.branchId === req.branchId &&
          dayjs(s.startsAt).isBefore(windowEnd) &&
          dayjs(s.endsAt).isAfter(windowStart)
      ).length;

      if (covering < req.requiredStaff) {
        gaps.push({
          branch_id: req.branchId,
          branchName,
          when: `${day.format("ddd D MMM")} · ${req.startTime.slice(0, 5)} – ${req.endTime.slice(0, 5)}`,
          need:
            covering === 0
              ? `${branchName} — nobody rostered`
              : `${branchName} — ${req.requiredStaff - covering} short`,
          severity: covering === 0 ? "danger" : "warning",
          pill: covering === 0 ? "Unstaffed" : "Short",
        });
      }
    }
  }
  return gaps;
}

// ── GET /api/time/roster ─────────────────────────────────────────────────────
exports.getRoster = async (req, res) => {
  try {
    const canViewAll = has(req, "time.view_all");
    const branchScope = resolveBranchScope(req);

    const filters = [gte(shiftSchedules.startsAt, dayjs().startOf("day").toISOString())];
    if (!canViewAll) filters.push(eq(shiftSchedules.userId, req.user.id));
    else if (branchScope) filters.push(eq(shiftSchedules.branchId, branchScope));

    const rows = await db
      .select({
        shift: shiftSchedules,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        branchName: branches.name,
      })
      .from(shiftSchedules)
      .leftJoin(users, eq(shiftSchedules.userId, users.id))
      .leftJoin(branches, eq(shiftSchedules.branchId, branches.id))
      .where(and(...filters))
      .orderBy(asc(shiftSchedules.startsAt))
      .limit(50);

    return res.json({
      shifts: rows.map((r) => ({
        id: r.shift.id,
        user_id: r.shift.userId,
        branch_id: r.shift.branchId,
        starts_at: r.shift.startsAt,
        ends_at: r.shift.endsAt,
        note: r.shift.note,
        staffName: displayName(r),
        branchName: r.branchName,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/time/audit ──────────────────────────────────────────────────────
// The console's audit page. Reuses the shared `logs` table rather than keeping
// a second audit trail — every controller here already writes to it via
// createLog, so there is one append-only record of who changed what.
//
// /api/logs filters a single module; this view spans every time-related one,
// and derives the origin (Console / Mobile / Automation) the console displays.
const TIME_MODULES = ["time_entries", "branch_clock_rules", "branch_access_points", "branch_pay_rules"];

const auditSource = (row) => {
  // No actor means the system did it (auto clock-out and friends).
  if (!row.userId) return "Automation";
  const ua = row.userAgent ?? "";
  if (/expo|okhttp|dart|cfnetwork|android|iphone/i.test(ua)) return "Mobile";
  return "Console";
};

exports.getAudit = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const rows = await db
      .select({
        id: logs.id,
        action: logs.action,
        module: logs.module,
        recordId: logs.recordId,
        description: logs.description,
        metadata: logs.metadata,
        userAgent: logs.userAgent,
        createdAt: logs.createdAt,
        userId: logs.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(logs)
      .leftJoin(users, eq(logs.userId, users.id))
      .where(inArray(logs.module, TIME_MODULES))
      .orderBy(desc(logs.createdAt))
      .limit(limit);

    return res.json({
      entries: rows.map((r) => ({
        id: r.id,
        when: r.createdAt,
        who: r.userId ? displayName(r) : "System",
        action: r.action,
        module: r.module,
        record_id: r.recordId,
        text: r.description,
        metadata: r.metadata,
        source: auditSource(r),
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/time/settings ───────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const branchScope = resolveBranchScope(req) ?? req.user.branchId;

    const [rules] = await db
      .select()
      .from(branchClockRules)
      .where(eq(branchClockRules.branchId, branchScope))
      .limit(1);

    const [pay] = await db
      .select()
      .from(branchPayRules)
      .where(eq(branchPayRules.branchId, branchScope))
      .limit(1);

    const aps = await db
      .select({ ap: branchAccessPoints, branchName: branches.name })
      .from(branchAccessPoints)
      .leftJoin(branches, eq(branchAccessPoints.branchId, branches.id))
      .where(
        // Admins viewing all branches should see every AP, not none.
        resolveBranchScope(req) === null ? sql`true` : eq(branchAccessPoints.branchId, branchScope)
      )
      .orderBy(asc(branchAccessPoints.id));

    return res.json({
      branch_id: branchScope,
      clock_rules: rules
        ? {
            branch_id: rules.branchId,
            wifi_lock: rules.wifiLock,
            geo_lock: rules.geoLock,
            geo_radius_m: rules.geoRadiusM,
            latitude: rules.latitude,
            longitude: rules.longitude,
            auto_clock_out: rules.autoClockOut,
            auto_clock_out_at: rules.autoClockOutAt,
            late_grace_minutes: rules.lateGraceMinutes,
            updated_at: rules.updatedAt,
          }
        : null,
      pay_rules: pay
        ? {
            branch_id: pay.branchId,
            normal_week_hours: pay.normalWeekHours,
            overtime_multiplier: pay.overtimeMultiplier,
            holiday_multiplier: pay.holidayMultiplier,
            unpaid_break_minutes: pay.unpaidBreakMinutes,
            pay_period_day: pay.payPeriodDay,
            hourly_rate: pay.hourlyRate,
            updated_at: pay.updatedAt,
          }
        : null,
      access_points: aps.map((r) => ({
        id: r.ap.id,
        branch_id: r.ap.branchId,
        ssid: r.ap.ssid,
        bssid: r.ap.bssid,
        label: r.ap.label,
        is_allowed: r.ap.isAllowed,
        branchName: r.branchName,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/time/settings/rules ─────────────────────────────────────────────
exports.updateClockRules = async (req, res) => {
  try {
    const branchScope = resolveBranchScope(req) ?? req.user.branchId;
    const { wifiLock, geoLock, geoRadiusM, latitude, longitude, autoClockOut, autoClockOutAt, lateGraceMinutes } = req.body;

    const [existing] = await db
      .select()
      .from(branchClockRules)
      .where(eq(branchClockRules.branchId, branchScope))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "No clock rules for this branch" });

    const patch = { updatedBy: req.user.id, updatedAt: new Date().toISOString() };
    if (wifiLock !== undefined) patch.wifiLock = !!wifiLock;
    if (geoLock !== undefined) patch.geoLock = !!geoLock;
    if (geoRadiusM !== undefined) patch.geoRadiusM = Number(geoRadiusM);
    if (latitude !== undefined) patch.latitude = latitude === null ? null : Number(latitude);
    if (longitude !== undefined) patch.longitude = longitude === null ? null : Number(longitude);
    if (autoClockOut !== undefined) patch.autoClockOut = !!autoClockOut;
    if (autoClockOutAt !== undefined) patch.autoClockOutAt = autoClockOutAt;
    if (lateGraceMinutes !== undefined) patch.lateGraceMinutes = Number(lateGraceMinutes);

    const [updated] = await db
      .update(branchClockRules)
      .set(patch)
      .where(eq(branchClockRules.branchId, branchScope))
      .returning();

    await createLog(
      req,
      "UPDATE",
      "branch_clock_rules",
      branchScope,
      "Updated clock-in rules",
      {
        before: { wifiLock: existing.wifiLock, geoLock: existing.geoLock, geoRadiusM: existing.geoRadiusM, autoClockOut: existing.autoClockOut },
        after: { wifiLock: updated.wifiLock, geoLock: updated.geoLock, geoRadiusM: updated.geoRadiusM, autoClockOut: updated.autoClockOut },
      }
    );

    return res.json({ clock_rules: updated });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/time/settings/pay-rules ─────────────────────────────────────────
exports.updatePayRules = async (req, res) => {
  try {
    const branchScope = resolveBranchScope(req) ?? req.user.branchId;
    const { normalWeekHours, overtimeMultiplier, holidayMultiplier, unpaidBreakMinutes, payPeriodDay, hourlyRate } = req.body;

    const [existing] = await db
      .select()
      .from(branchPayRules)
      .where(eq(branchPayRules.branchId, branchScope))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "No pay rules for this branch" });

    const patch = { updatedBy: req.user.id, updatedAt: new Date().toISOString() };
    if (normalWeekHours !== undefined) patch.normalWeekHours = Number(normalWeekHours);
    if (overtimeMultiplier !== undefined) patch.overtimeMultiplier = Number(overtimeMultiplier);
    if (holidayMultiplier !== undefined) patch.holidayMultiplier = Number(holidayMultiplier);
    if (unpaidBreakMinutes !== undefined) patch.unpaidBreakMinutes = Number(unpaidBreakMinutes);
    if (payPeriodDay !== undefined) patch.payPeriodDay = Number(payPeriodDay);
    if (hourlyRate !== undefined) patch.hourlyRate = hourlyRate === null ? null : Number(hourlyRate);

    const [updated] = await db
      .update(branchPayRules)
      .set(patch)
      .where(eq(branchPayRules.branchId, branchScope))
      .returning();

    // A rule change applies from the next pay period; it never rewrites
    // approved timesheets, so nothing else is touched here.
    await createLog(req, "UPDATE", "branch_pay_rules", branchScope, "Updated pay rules", {
      before: existing,
      after: updated,
    });

    return res.json({ pay_rules: updated });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── POST /api/time/settings/access-points ────────────────────────────────────
exports.addAccessPoint = async (req, res) => {
  try {
    const { ssid, bssid, label, isAllowed, branchId } = req.body;
    const scope = resolveBranchScope(req);
    const targetBranch = scope ?? (branchId ? Number(branchId) : req.user.branchId);

    if (!ssid || !bssid) return res.status(400).json({ message: "ssid and bssid are required" });

    const normalized = normalizeBssid(bssid);
    if (!normalized) {
      return res.status(400).json({ message: "bssid must look like A4:2B:B0:77:1E:C3" });
    }

    const [inserted] = await db
      .insert(branchAccessPoints)
      .values({
        branchId: targetBranch,
        ssid,
        bssid: normalized,
        label: label ?? null,
        isAllowed: isAllowed === undefined ? true : !!isAllowed,
      })
      .returning();

    await createLog(req, "CREATE", "branch_access_points", inserted.id, `Added access point ${ssid} (${normalized})`, {
      branchId: targetBranch,
      isAllowed: inserted.isAllowed,
    });

    return res.status(201).json({ access_point: inserted });
  } catch (error) {
    if (error?.cause?.code === "23505") {
      return res.status(409).json({ message: "That BSSID is already registered for this branch" });
    }
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── DELETE /api/time/settings/access-points/:id ──────────────────────────────
exports.deleteAccessPoint = async (req, res) => {
  try {
    const { id } = req.params;
    const scope = resolveBranchScope(req);

    const filters = [eq(branchAccessPoints.id, Number(id))];
    if (scope) filters.push(eq(branchAccessPoints.branchId, scope));

    const [existing] = await db.select().from(branchAccessPoints).where(and(...filters)).limit(1);
    if (!existing) return res.status(404).json({ message: "Access point not found" });

    await db.delete(branchAccessPoints).where(eq(branchAccessPoints.id, existing.id));

    await createLog(
      req,
      "DELETE",
      "branch_access_points",
      existing.id,
      `Removed access point ${existing.ssid} (${existing.bssid})`,
      { branchId: existing.branchId }
    );

    return res.json({ message: "Access point removed" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};
