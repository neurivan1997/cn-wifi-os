const express = require("express");
const { execSync } = require("child_process");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const status = execSync("sudo ndsctl status").toString();

    res.json({
      ok: true,
      status
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

router.post("/limpar", (req, res) => {
  try {
    execSync("sudo systemctl restart opennds");

    res.json({
      ok: true
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

module.exports = router;
