const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const archiver = require("archiver");
const crypto = require("crypto");
const { makeid } = require("./id");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require("@whiskeysockets/baileys");

const router = express.Router();
const sessionRoot = path.join(__dirname, "sessions");

if (!fs.existsSync(sessionRoot)) {
  fs.mkdirSync(sessionRoot, { recursive: true });
}

function deleteFolder(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

/* ===================================================== */
/* MAIN */
/* ===================================================== */

router.get("/", async (req, res) => {

  const number = (req.query.number || "").replace(/[^0-9]/g, "");
  if (!number) return res.status(400).json({ error: "Number Required" });

  const id = makeid();
  const tempDir = path.join(sessionRoot, id);

  fs.mkdirSync(tempDir, { recursive: true });

  try {

    const { state, saveCreds } = await useMultiFileAuthState(tempDir);

    const sock = makeWASocket({

      version: [2, 3000, 1033105955],
      logger: pino({ level: "fatal" }),
      printQRInTerminal: false,

      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys)
      },

      browser: Browsers("Chrome")

    });

    const pairingCode = await sock.requestPairingCode(number);

    res.json({
      code: pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode,
      download: `/api/download?id=${id}`
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {

      if (update.connection === "open") {

        await delay(20000);

        const credsPath = path.join(tempDir, "creds.json");
        if (!fs.existsSync(credsPath)) return;

        /* ================= PASSWORD ================= */

        const password = crypto.randomBytes(5).toString("hex");

        /* ================= ZIP CREATE ================= */

        const zipPath = path.join(sessionRoot, `${id}.zip`);

        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.pipe(output);
        archive.directory(tempDir, false);
        await archive.finalize();

        output.on("close", async () => {

          /* ================= SEND ZIP ================= */

          await sock.sendMessage(sock.user.id, {
            document: { url: zipPath },
            fileName: `${id}.zip`,
            mimetype: "application/zip",
            caption: `🔥 SESSION FILE\n🔐 Password: ${password}`
          });

          await delay(5000);

          sock.ws.close();
          deleteFolder(tempDir);

          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
          }

        });

      }

      if (update.connection === "close") {
        deleteFolder(tempDir);
      }

    });

  } catch (err) {
    console.log("Pair Error:", err);
    deleteFolder(tempDir);
  }

});

/* ===================================================== */
/* DOWNLOAD ROUTE */
/* ===================================================== */

router.get("/download", (req, res) => {

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "ID Required" });

  const zipPath = path.join(sessionRoot, `${id}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: "File Not Found" });
  }

  res.download(zipPath, `${id}.zip`, () => {
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
  });

});

module.exports = router;
