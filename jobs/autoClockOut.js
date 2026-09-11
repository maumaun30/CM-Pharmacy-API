const { and, eq, isNull } = require("drizzle-orm");
const dayjs = require("dayjs");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { emitTimeClock, emitDashboardRefresh } = require("../utils/socket");

const { timeEntries, branchClockRules } = schema;

// ─────────────────────────────────────────────────────────────────────────────
// Auto clock-out: close shifts someone forgot to end.
//
// Without this, a missed clock-out bills the whole night — and worse, the person
// stays "on shift" forever, so the next day's clock-in is rejected by the
// one-open-shift-per-user constraint. The branch rule (auto_clock_out_at,
// default 22:00) says when to draw the line.
//
// The closed entry is marked auto_closed and left PENDING, never approved: the
// end time is a guess, and a supervisor has to replace it with the real one.
// The console surfaces these under "Needs attention" and the mobile timesheet
// shows the note strip.
//
// Day boundaries follow the server's timezone (server.js pins Asia/Manila), so
// the cutoff is computed in JS with dayjs rather than in SQL — matching how the
// rest of the codebase does date math.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The moment a given shift should have been closed.
 *
 * Normally that is the cutoff time on the day the shift started. A shift that
 * began AFTER the cutoff (clocked in at 23:00 with a 22:00 rule) rolls to the
 * next day's cutoff — otherwise the computed end would precede the start and
 * the row's own CHECK constraint would reject the update.
 */
function cutoffFor(clockInAt, autoClockOutAt) {
  const [h, m, s] = String(autoClockOutAt).split(":").map(Number);
  const start = dayjs(clockInAt);
  let cutoff = start.hour(h || 0).minute(m || 0).second(s || 0).millisecond(0);
  if (!cutoff.isAfter(start)) cutoff = cutoff.add(1, "day");
  return cutoff;
}

/**
 * Close every open shift whose cutoff has passed.
 * Returns the entries it closed, so callers (and tests) can assert on them.
 */
async function runAutoClockOut({ now = dayjs() } = {}) {
  const closed = [];

  const openShifts = await db
    .select({ entry: timeEntries, rules: branchClockRules })
    .from(timeEntries)
    .innerJoin(branchClockRules, eq(timeEntries.branchId, branchClockRules.branchId))
    .where(and(isNull(timeEntries.clockOutAt), eq(branchClockRules.autoClockOut, true)));

  for (const { entry, rules } of openShifts) {
    const cutoff = cutoffFor(entry.clockInAt, rules.autoClockOutAt);
    if (!now.isAfter(cutoff)) continue; // still within the working day

    // A break left running is closed at the cutoff too, so its minutes are not
    // silently lost from the total.
    const breakMinutes = entry.breakStartedAt
      ? entry.breakMinutes +
        Math.max(0, cutoff.diff(dayjs(entry.breakStartedAt), "minute"))
      : entry.breakMinutes;

    const [updated] = await db
      .update(timeEntries)
      .set({
        clockOutAt: cutoff.toISOString(),
        breakMinutes,
        breakStartedAt: null,
        status: "pending",
        source: "automation",
        autoClosed: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(timeEntries.id, entry.id))
      .returning();

    if (!updated) continue;
    closed.push(updated);

    // No req here: createLog tolerates a bare object, and a null user_id is what
    // makes the audit view render this as System / Automation.
    await createLog(
      { user: null, headers: {} },
      "UPDATE",
      "time_entries",
      updated.id,
      `Auto-closed forgotten shift at ${cutoff.format("HH:mm")} — needs a real end time`,
      {
        branchId: updated.branchId,
        userId: updated.userId,
        clockInAt: entry.clockInAt,
        autoClockOutAt: rules.autoClockOutAt,
      }
    );

    emitTimeClock(updated.branchId, {
      action: "auto-clock-out",
      entry: { id: updated.id, user_id: updated.userId, branch_id: updated.branchId },
    });
  }

  if (closed.length > 0) {
    emitDashboardRefresh();
    console.log(`[autoClockOut] closed ${closed.length} forgotten shift(s)`);
  }

  return closed;
}

/**
 * Run the sweep on a timer.
 *
 * A plain interval, not a cron dependency: the API is a single container, and
 * the job is idempotent — a shift already closed no longer matches the query.
 * If this ever runs multiple replicas, this needs an advisory lock so two
 * instances don't race on the same rows.
 */
function startAutoClockOutJob({ intervalMs = 5 * 60_000 } = {}) {
  if (process.env.DISABLE_AUTO_CLOCK_OUT === "true") {
    console.log("[autoClockOut] disabled via DISABLE_AUTO_CLOCK_OUT");
    return null;
  }

  const tick = async () => {
    try {
      await runAutoClockOut();
    } catch (error) {
      // A sweep failure must never take the API down; the next tick retries.
      console.error("[autoClockOut] sweep failed:", error.message);
    }
  };

  tick(); // catch anything left open while the server was down
  const timer = setInterval(tick, intervalMs);
  timer.unref?.(); // never hold the process open on shutdown
  return timer;
}

module.exports = { runAutoClockOut, startAutoClockOutJob, cutoffFor };
