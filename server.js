const app = require("./app");
const supabase = require("./config/supabase");

const PORT = process.env.PORT || 3000;

const testDbConnection = async () => {
  try {
    // A lightweight query to verify Supabase connectivity
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) throw error;
    console.log("Supabase connection established successfully.");
  } catch (error) {
    console.error("Unable to connect to Supabase:", error.message);
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