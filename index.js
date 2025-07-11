const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const { google } = require('googleapis');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

// Load Google Drive credentials
const CREDENTIALS = JSON.parse(fs.readFileSync('uploads/credentials.json'));
const { client_id, client_secret, redirect_uris } = CREDENTIALS.web;


const oAuth2Client = new google.auth.OAuth2(
  client_id, client_secret, redirect_uris[0]
);

const TOKEN_PATH = 'token.json';

// Step 1: Google OAuth flow
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  res.send('Authentication successful! Token saved.');
});

// Upload APK to Drive
app.post('/upload', upload.single('apkFile'), async (req, res) => {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  const fileMetadata = { name: req.file.originalname };
  const media = {
    mimeType: req.file.mimetype,
    body: fs.createReadStream(req.file.path)
  };

  try {
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });

    res.json({
      message: 'File uploaded successfully!',
      file: response.data
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).send('Upload failed');
  }
});

// List all APKs from Drive
app.get('/list-apks', async (req, res) => {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });

  try {
    const result = await drive.files.list({
      q: "name contains '.apk'",
      fields: 'files(id, name, webViewLink, webContentLink)',
    });

    res.json(result.data.files);
  } catch (err) {
    console.error('List Error:', err);
    res.status(500).send('Failed to list APKs');
  }
});

app.listen(3000, () => {
  console.log('API running on port 3000');
});
