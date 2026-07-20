// TOTP 2FA challenge endpoints (superadmin only).
// Design: docs/superpowers/specs/2026-07-17-superadmin-totp-design.md
//
// /setup, /verify-setup and /verify run in the PRE-AUTH stage: the caller holds
// only the 5-minute { stage: "totp" } token issued by login after the password
// (or Google) check. authenticateTotpStage loads req.totpUser for them.
// /backup-codes/regenerate requires a FULL token (authenticateUser).

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const { eq } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { signToken, safeUser } = require("./authController");

const { users } = schema;

// Accept codes from the adjacent 30 s windows to absorb clock drift.
authenticator.options = { window: 1 };

const TOTP_ISSUER = process.env.TOTP_ISSUER || "Maun Pharmacy";
const BACKUP_CODE_COUNT = 10;

// 8-char uppercase alphanumeric, unambiguous alphabet (no O/0/I/1 confusion).
const generateBackupCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
};

const generateBackupCodes = async () => {
  const plaintext = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashes = await Promise.all(plaintext.map((c) => bcrypt.hash(c, 10)));
  return { plaintext, hashes };
};

// ─── Setup: issue a secret + provisioning URL ────────────────────────────────
// Idempotent until verified: re-calling replaces the pending secret. Never
// touches an already-enabled enrollment.
exports.setup = async (req, res) => {
  try {
    const user = req.totpUser;

    if (user.totpEnabled) {
      return res.status(400).json({ message: "TOTP is already enabled" });
    }

    const secret = authenticator.generateSecret();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));

    return res.status(200).json({
      otpauth_url: authenticator.keyuri(user.username, TOTP_ISSUER, secret),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Verify setup: confirm first code, enable 2FA, issue backup codes ────────
exports.verifySetup = async (req, res) => {
  try {
    const user = req.totpUser;
    const { code } = req.body;

    if (!code) return res.status(400).json({ message: "Code is required" });
    if (user.totpEnabled) {
      return res.status(400).json({ message: "TOTP is already enabled" });
    }
    if (!user.totpSecret) {
      return res.status(400).json({ message: "TOTP setup has not been started" });
    }

    if (!authenticator.verify({ token: String(code), secret: user.totpSecret })) {
      await createLog(req, "LOGIN", "auth", user.id, "Failed TOTP setup attempt", {});
      return res.status(401).json({ message: "Invalid authenticator code" });
    }

    const { plaintext, hashes } = await generateBackupCodes();
    await db
      .update(users)
      .set({ totpEnabled: true, totpBackupCodes: hashes })
      .where(eq(users.id, user.id));

    await createLog(req, "UPDATE", "auth", user.id, "TOTP enrollment completed", {});
    await createLog(req, "LOGIN", "auth", user.id, `User ${user.username} logged in`, {
      role: user.role,
      totp: "setup",
    });

    // The only time the plaintext backup codes ever leave the server.
    return res.status(200).json({
      message: "TOTP enabled",
      backup_codes: plaintext,
      user: safeUser(user),
      token: signToken(user),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Verify: TOTP code or one backup code → full JWT ─────────────────────────
exports.verify = async (req, res) => {
  try {
    const user = req.totpUser;
    const { code } = req.body;

    if (!code) return res.status(400).json({ message: "Code is required" });
    if (!user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ message: "TOTP is not enabled for this account" });
    }

    const input = String(code).trim();
    let usedBackup = false;

    if (!authenticator.verify({ token: input, secret: user.totpSecret })) {
      // Fall back to backup codes: find the matching hash and burn it.
      const hashes = Array.isArray(user.totpBackupCodes) ? user.totpBackupCodes : [];
      let matchIndex = -1;
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(input.toUpperCase(), hashes[i])) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex === -1) {
        await createLog(req, "LOGIN", "auth", user.id, "Failed TOTP attempt", {});
        return res.status(401).json({ message: "Invalid code" });
      }

      usedBackup = true;
      const remaining = hashes.filter((_, i) => i !== matchIndex);
      await db.update(users).set({ totpBackupCodes: remaining }).where(eq(users.id, user.id));
      await createLog(req, "LOGIN", "auth", user.id, "Login via backup code", {
        remaining_backup_codes: remaining.length,
      });
    }

    await createLog(req, "LOGIN", "auth", user.id, `User ${user.username} logged in`, {
      role: user.role,
      totp: usedBackup ? "backup_code" : "code",
    });

    return res.status(200).json({
      message: "Login successful",
      user: safeUser(user),
      token: signToken(user),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Regenerate backup codes (fully authenticated superadmin) ────────────────
exports.regenerateBackupCodes = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Current authenticator code is required" });

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        totpSecret: users.totpSecret,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user || !user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ message: "TOTP is not enabled for this account" });
    }

    if (!authenticator.verify({ token: String(code), secret: user.totpSecret })) {
      await createLog(req, "UPDATE", "auth", user.id, "Failed TOTP attempt", {
        context: "backup_codes_regenerate",
      });
      return res.status(401).json({ message: "Invalid authenticator code" });
    }

    const { plaintext, hashes } = await generateBackupCodes();
    await db.update(users).set({ totpBackupCodes: hashes }).where(eq(users.id, user.id));

    await createLog(req, "UPDATE", "auth", user.id, "Backup codes regenerated", {});

    return res.status(200).json({
      message: "Backup codes regenerated",
      backup_codes: plaintext,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
