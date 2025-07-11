const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());

// Load credentials.json (located in uploads folder)
const credentialsPath = path.join(__dirname, 'uploads', 'credentials.json');

if (!fs.existsSync(credentialsPath)) {
  console.error('❌ credentials.json not found!');
  process.exit(1);
}

const CREDENTIALS = JSON.parse(fs.readFileSync(credentialsPath));
const { client_id, client_secret, redirect_uris } = CREDENTIALS.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0] // should be: https://your-app.onrender.com/oauth2callback
);

const TOKEN_PATH = path.join(__dirname, 'token.json');

// 🔐 Step 1: Start Google OAuth flow
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
  res.redirect(authUrl);
});

// 🔑 Step 2: Handle redirect from Google after user grants permission
app.get('/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Missing code in callback');
    }

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Token saved to token.json');

    res.send('✅ Authentication successful! You can now upload or list APKs.');
  } catch (error) {
    console.error('❌ OAuth Callback Error:', error);
    res.status(500).send('Something went wrong during Google OAuth.');
  }
});

// 📤 Upload APK to Google Drive
app.post('/upload', upload.single('apkFile'), async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return res.status(401).send('Token not found. Authenticate first.');

    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    const fileMetadata = { name: req.file.originalname };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path)
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, name, webViewLink, webContentLink'
    });

    res.json({
      message: '✅ File uploaded successfully!',
      file: response.data
    });
  } catch (error) {
    console.error('❌ Upload Error:', error);
    res.status(500).send('Upload failed.');
  }
});

// 📄 List all APKs from Google Drive
app.get('/list-apks', async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return res.status(401).send('Token not found. Authenticate first.');

    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    const result = await drive.files.list({
      q: "name contains '.apk'",
      fields: 'files(id, name, webViewLink, webContentLink)',
    });

    res.json(result.data.files);
  } catch (error) {
    console.error('❌ List Error:', error);
    res.status(500).send('Failed to list APKs.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
