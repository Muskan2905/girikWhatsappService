const express = require('express');
const https   = require('https');
const app     = express();

app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ─── SFMC CREDENTIALS ─────────────────────────────────────────────────────────
const SFMC_CLIENT_ID     = process.env.SFMC_CLIENT_ID;
const SFMC_CLIENT_SECRET = process.env.SFMC_CLIENT_SECRET;
const SFMC_MID           = process.env.SFMC_MID;
const SFMC_SUBDOMAIN     = 'mc97sb5jfx5jwlk8yysdds5268h1';
const TEMPLATES_DE_KEY   = '6A0F8F29-E201-4064-AB1F-1986FF072B2A'; // your WA templates DE external key

// ─── SFMC TOKEN CACHE ─────────────────────────────────────────────────────────
let sfmcToken = null;
let sfmcTokenExpiry = 0;

async function getSfmcToken() {
    const now = Date.now();
    if (sfmcToken && now < sfmcTokenExpiry) return sfmcToken;

    const body = JSON.stringify({
        grant_type:    'client_credentials',
        client_id:     SFMC_CLIENT_ID,
        client_secret: SFMC_CLIENT_SECRET,
        account_id:    SFMC_MID
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: `${SFMC_SUBDOMAIN}.auth.marketingcloudapis.com`,
            path:     '/v2/token',
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.access_token) return reject(new Error('No access_token: ' + data));
                    sfmcToken = parsed.access_token;
                    sfmcTokenExpiry = Date.now() + ((parsed.expires_in - 300) * 1000);
                    resolve(sfmcToken);
                } catch (e) {
                    reject(new Error('Token parse error: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
app.get('/config.json', (req, res) => {
    res.json({
        "workflowApiVersion": "1.1",
        "metaData": {
            "icon": "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
            "smallIcon": "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
            "category": "message"
        },
        "type": "REST",
        "lang": {
            "en-US": {
                "name": "Girik WhatsApp",
                "description": "Sends a WhatsApp message per contact via Twilio"
            }
        },
        "arguments": {
            "execute": {
                "inArguments": [],
                "url": "https://girikwhatsappservice.onrender.com/execute",
                "verb": "POST",
                "body": "",
                "header": "",
                "format": "json",
                "timeout": 10000,
                "retryCount": 2,
                "retryDelay": 1000,
                "concurrentRequests": 5
            }
        },
        "configurationArguments": {
            "save":     { "url": "https://girikwhatsappservice.onrender.com/save",     "verb": "POST" },
            "validate": { "url": "https://girikwhatsappservice.onrender.com/validate", "verb": "POST" },
            "publish":  { "url": "https://girikwhatsappservice.onrender.com/publish",  "verb": "POST" },
            "stop":     { "url": "https://girikwhatsappservice.onrender.com/stop",     "verb": "POST" }
        },
        "userInterfaces": {
            "configModal": {
                "url": "REPLACE_WITH_YOUR_CLOUDPAGE_URL",
                "width": 800,
                "height": 600
            }
        }
    });
});

// ─── LIFECYCLE ENDPOINTS ──────────────────────────────────────────────────────
app.post('/save',     (req, res) => { console.log("SAVE");    res.status(200).json({ success: true }); });
app.post('/publish',  (req, res) => { console.log("PUBLISH"); res.status(200).json({ success: true }); });
app.post('/stop',     (req, res) => { console.log("STOP");    res.status(200).json({ success: true }); });

app.post('/validate', (req, res) => {
    const inArgs = req.body?.arguments?.execute?.inArguments?.[0];
    if (!inArgs?.messageTitle) {
        return res.status(200).json({ success: false, message: "Message Title is required" });
    }
    res.status(200).json({ success: true });
});

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
app.get('/templates', async (req, res) => {
    try {
        const templates = await fetchTemplates();
        res.status(200).json({ success: true, templates });
    } catch (err) {
        console.error("TEMPLATES error:", err);
        res.status(200).json({ success: false, message: err.message });
    }
});

async function fetchTemplates() {
    const token = await getSfmcToken();

    return new Promise((resolve, reject) => {
        const options = {
            hostname: `${SFMC_SUBDOMAIN}.rest.marketingcloudapis.com`,
            path:     `/data/v1/customobjectdata/key/${TEMPLATES_DE_KEY}/rowset`,
            method:   'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const items = parsed.items || [];
                    const templates = items.map(item => ({
                        id:   item.values.templateid,
                        name: item.values.templatename,
                        body: item.values.templatebody
                    }));
                    resolve(templates);
                } catch (e) {
                    reject(new Error('Templates parse error: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(9000, () => { req.destroy(); reject(new Error('Templates fetch timed out')); });
        req.end();
    });
}

// ─── EXECUTE ──────────────────────────────────────────────────────────────────
app.post('/execute', async (req, res) => {
    console.log("=== EXECUTE CALLED ===");
    console.log("FULL BODY:", JSON.stringify(req.body, null, 2));

    try {
        const inArgs = req.body?.inArguments?.[0];
        if (!inArgs) {
            console.error("No inArguments in execute payload");
            return res.status(200).json({ success: false, message: "No inArguments" });
        }

        const contactKey      = inArgs.contactKey || req.body.keyValue;
        const messageTitle    = inArgs.messageTitle || '';
        const fromPhoneNumber = inArgs.fromPhoneNumber;
        const toPhoneNumber   = inArgs.toPhoneField;
        const templateBody    = inArgs.templateBody || '';

        console.log(`contactKey: ${contactKey}`);
        console.log(`messageTitle: ${messageTitle}`);
        console.log(`From: ${fromPhoneNumber}, To: ${toPhoneNumber}`);
        console.log(`templateBody: ${templateBody}`);

        if (!contactKey) {
            return res.status(200).json({ success: false, message: "No contactKey in inArguments" });
        }

        if (!toPhoneNumber) {
            console.error(`toPhoneField resolved empty for contact: ${contactKey}`);
            return res.status(200).json({ success: false, message: "Resolved phone number is empty" });
        }

        if (!fromPhoneNumber) {
            return res.status(200).json({ success: false, message: "fromPhoneNumber is empty" });
        }

        const ssjs_result = await callSsjsCloudPage({
            messageTitle,
            fromPhoneNumber,
            toPhoneNumber,
            messageBody: templateBody
        });

        console.log("SSJS CloudPage response:", ssjs_result);
        res.status(200).json({ success: true, ssjs: ssjs_result });

    } catch (err) {
        console.error("EXECUTE error:", err);
        res.status(200).json({ success: false, message: err.message });
    }
});

// ─── HELPER: POST to SSJS CloudPage ──────────────────────────────────────────
function callSsjsCloudPage(params) {
    return new Promise((resolve, reject) => {
        const SSJS_CLOUDPAGE_URL = 'REPLACE_WITH_YOUR_WHATSAPP_SSJS_CLOUDPAGE_URL';

        const body = Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');

        const urlObj = new URL(SSJS_CLOUDPAGE_URL);

        const options = {
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method:   'POST',
            headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const request = https.request(options, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve({ statusCode: response.statusCode, body: data }));
        });

        request.on('error', reject);
        request.setTimeout(9000, () => {
            request.destroy();
            reject(new Error('SSJS CloudPage request timed out'));
        });

        request.write(body);
        request.end();
    });
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({ status: 'Girik WhatsApp Service running' });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Girik WhatsApp Service backend on port ${PORT}`));
