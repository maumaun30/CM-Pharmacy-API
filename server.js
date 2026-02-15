const app = require("./app");
const { sequelize } = require("./models");

const PORT = process.env.PORT || 3000;

// Test database connection
const testDbConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log("Database connection has been established successfully.");
  } catch (error) {
    console.error("Unable to connect to the database:", error);
    process.exit(1);
  }
};

const server = app.get("server");

// Start server
const startServer = async () => {
  await testDbConnection();

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.IO initialized`);
  });
};

startServer();
