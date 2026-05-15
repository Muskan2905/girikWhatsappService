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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
app.get('/config.json', (req, res) => {
    res.json({
        "workflowApiVersion": "1.1",
        "metaData": {
            "icon": "https://res.cloudinary.com/dwdj0l58l/image/upload/v1771527602/icons8-threads-50_i5bnnj.png",
            "smallIcon": "https://res.cloudinary.com/dwdj0l58l/image/upload/v1771527602/icons8-threads-50_i5bnnj.png",
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
app.post('/save',     (req, res) => { console.log("SAVE");     res.status(200).json({ success: true }); });
app.post('/publish',  (req, res) => { console.log("PUBLISH");  res.status(200).json({ success: true }); });
app.post('/stop',     (req, res) => { console.log("STOP");     res.status(200).json({ success: true }); });

app.post('/validate', (req, res) => {
    const inArgs = req.body?.arguments?.execute?.inArguments?.[0];
    if (!inArgs?.messageTitle) {
        return res.status(200).json({ success: false, message: "Message Title is required" });
    }
    res.status(200).json({ success: true });
});

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

        console.log(`contactKey: ${contactKey}`);
        console.log(`messageTitle: ${messageTitle}`);
        console.log(`From: ${fromPhoneNumber}, To: ${toPhoneNumber}`);

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

        const rawTemplate = inArgs.templateBody || '';
        console.log('rawTemplate:', rawTemplate);

        const messageBody = rawTemplate.replace(
            /{(\w+)}/g,
            function(match, fieldName) {
                const value = inArgs[fieldName];
                console.log('match:', match, 'fieldName:', fieldName, 'value:', value);
                return value !== undefined && value !== null ? String(value) : "";
            }
        );

        console.log('resolvedBody:', messageBody);

        const ssjs_result = await callSsjsCloudPage({
            messageTitle,
            fromPhoneNumber,
            toPhoneNumber,
            messageBody
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
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Girik WhatsApp Service backend on port ${PORT}`));
