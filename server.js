// Run all server-side date math in Philippine time (Asia/Manila) unless the
// deployment overrides TZ. Set before requiring app so every Date / dayjs
// startOf("day") computes day boundaries in PH time, not the host's UTC.
process.env.TZ = process.env.TZ || "Asia/Manila";

const app = require("./app");
const { pool } = require("./config/db");

const PORT = process.env.PORT || 3000;

const testDbConnection = async () => {
  try {
    // A lightweight query to verify Postgres connectivity.
    await pool.query("select 1");
    console.log("Postgres connection established successfully.");
  } catch (error) {
    console.error("Unable to connect to Postgres:", error.message);
    process.exit(1);
  }
};

const server = app.get("server");

const startServer = async () => {
  await testDbConnection();

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.IO initialized`);
  });
};

startServer();