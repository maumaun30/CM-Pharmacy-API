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

// Start server
const startServer = async () => {
  await testDbConnection();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
