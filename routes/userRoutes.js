const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", requirePermission("users.read"), userController.getAllUsers);
router.post("/", requirePermission("users.write"), userController.createUser);
router.put("/:id", requirePermission("users.write"), userController.updateUser);
router.delete("/:id", requirePermission("users.write"), userController.deleteUser);

module.exports = router;
