const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", authorizeRoles("admin"), userController.getAllUsers);
router.post("/", authorizeRoles("admin"), userController.createUser);
router.put("/:id", authorizeRoles("admin"), userController.updateUser);
router.delete("/:id", authorizeRoles("admin"), userController.deleteUser);

module.exports = router;
