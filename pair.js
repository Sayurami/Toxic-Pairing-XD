const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');

const router = express.Router();
const sessionDir = path.join(__dirname, "temp");

function removeFile(filePath) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const num = (req.query.number || '').replace(/[^0-9]/g, '');
    const tempDir = path.join(sessionDir, id);
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                removeFile(tempDir);
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function startPairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            const sock = Toxic_Tech({
                version: [2, 3000, 1033105955],
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "silent", stream: 'store' }))
                },
                browser: Browsers.macOS("Chrome"), // පැහැදිලිව Browser එක සඳහන් කිරීම
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                getMessage: async () => undefined,
                markOnlineOnConnect: true,
                connectTimeoutMs: 120000,
                keepAliveIntervalMs: 30000,
                emitOwnEvents: true,
                fireInitQueries: true,
                defaultQueryTimeoutMs: 60000,
                transactionOpts: {
                    maxCommitRetries: 10,
                    delayBetweenTriesMs: 3000
                },
                retryRequestDelayMs: 10000
            });

            if (!sock.authState.creds.registered) {
                await delay(3000); 
                const code = await sock.requestPairingCode(num);
                if (!responseSent && !res.headersSent) {
                    res.json({ code: code });
                    responseSent = true;
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log('✅ Toxic-MD successfully connected.');
                    
                    // මුලින්ම පොඩි message එකක් යවනවා
                    try {
                        await sock.sendMessage(sock.user.id, {
                            text: "◈━━━━━━━━━━━◈\n❒ Connection Successful! Generating your JSON session data...\n◈━━━━━━━━━━━◈",
                        });
                    } catch (e) {}

                    await delay(10000); // creds.json එක ලිවීමට කාලය ලබා දීම

                    const credsPath = path.join(tempDir, "creds.json");
                    let sessionData = null;

                    // Creds file එක කියවීමට උත්සාහ කිරීම
                    for (let i = 0; i < 10; i++) {
                        if (fs.existsSync(credsPath)) {
                            const data = fs.readFileSync(credsPath, 'utf8');
                            if (data.length > 200) {
                                sessionData = data;
                                break;
                            }
                        }
                        await delay(3000);
                    }

                    if (sessionData) {
                        try {
                            // 1. JSON එක කෙලින්ම Text එකක් ලෙස යැවීම (ඔයා ඉල්ලපු විදිහට)
                            const sentMsg = await sock.sendMessage(sock.user.id, {
                                text: sessionData 
                            });

                            // 2. විස්තර සහිත message එකක් යැවීම
                            const infoMessage = `◈━━━━━━━━━━━◈
SESSION CONNECTED ✅

❒ Copy the JSON code above and use it as your session.
❒ This is your raw creds.json data.

『••• Support •••』
> Owner: wa.me/254735342808
> Repo: github.com/xhclintohn/Toxic-MD
◈━━━━━━━━━━━◈`;

                            await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentMsg });

                            console.log('✅ Session JSON sent successfully.');
                            await delay(5000);
                            sock.ws.close();
                            await cleanUpSession();
                        } catch (sendError) {
                            console.error("Error sending JSON:", sendError);
                        }
                    } else {
                        console.error("Could not find valid session data.");
                        await cleanUpSession();
                    }

                } else if (connection === "close") {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                    if (shouldReconnect) {
                        startPairing();
                    } else {
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('❌ Error:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: "Server Error" });
            }
        }
    }

    startPairing();
});

module.exports = router;
