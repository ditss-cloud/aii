//const config = require('./config.js');
require('dotenv').config();
const express = require('express');
const { formidable } = require('formidable');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const FormData = require('form-data');
const app = express();
const port = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;
const CDN_REPO = process.env.CDN_REPO;
const GIST_ID = process.env.GIST_ID;
const APP_DOMAIN = process.env.APP_DOMAIN;

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function generateRandomCode(length = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

app.get('/', (req, res) => {
  res.render('index', { config });
});

app.post('/upload', async (req, res) => {
  const form = formidable({});
  form.parse(req, async (err, fields, files) => {
    if (err || !files.file || !files.file[0]) {
      return res.status(400).json({ error: 'File upload failed.' });
    }
    const file = files.file[0];
    const fileExtension = path.extname(file.originalFilename);
    const fileContent = fs.readFileSync(file.filepath).toString('base64');
    let uniqueCode = generateRandomCode();
    let fileName = `${uniqueCode}${fileExtension}`;
    try {
      await githubApi.put(`/repos/${GITHUB_USER}/${CDN_REPO}/contents/${fileName}`, {
        message: `upload: ${fileName}`, content: fileContent,
      });
      res.json({ url: `${APP_DOMAIN}/${fileName}` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload file.' });
    }
  });
});

app.post('/shorten', async (req, res) => {
  const { longUrl, customCode } = req.body;
  if (!longUrl) return res.status(400).json({ error: 'URL is required.' });
  try {
    const { data: gist } = await githubApi.get(`/gists/${GIST_ID}`);
    const gistFile = Object.values(gist.files)[0];
    let links = JSON.parse(gistFile.content || '{}');
    let shortCode = customCode;
    if (!shortCode) {
      do { shortCode = generateRandomCode(); } while (links[shortCode]);
    } else if (links[shortCode]) {
      return res.status(400).json({ error: 'Custom code already in use.' });
    }
    links[shortCode] = longUrl;
    await githubApi.patch(`/gists/${GIST_ID}`, {
      files: { [gistFile.filename]: { content: JSON.stringify(links, null, 2) } },
    });
    res.json({ url: `${APP_DOMAIN}/${shortCode}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to shorten URL.' });
  }
});

app.get('/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { data: gist } = await githubApi.get(`/gists/${GIST_ID}`);
    const gistFile = Object.values(gist.files)[0];
    const links = JSON.parse(gistFile.content || '{}');
    if (links[code]) {
      return res.redirect(302, links[code]);
    }
  } catch (error) { /* Gist fetch failed, continue to CDN */ }

  try {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${CDN_REPO}/main/${code}`;
    const response = await axios({ method: 'get', url: rawUrl, responseType: 'stream' });
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Content-Length', response.headers['content-length']);
    response.data.pipe(res);
  } catch (error) {
    res.status(404).render('404');
  }
});
app.get('/api/proxy/editfoto2', async (req, res) => {
    try {
        const { url, prompt } = req.query;
        
        if (!url || !prompt) {
            return res.status(400).json({ 
                status: false,
                error: 'URL dan prompt diperlukan' 
            });
        }
        
        console.log('🔁 Proxy GET: Forwarding to ditss.biz.id', { 
            url: url.substring(0, 50) + '...', 
            prompt: prompt.substring(0, 30) + '...' 
        });
        
        const response = await axios.get('https://ditss.biz.id/api/ai/editfoto2', {
            params: { url, prompt },
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        console.log('✅ Proxy GET: Success');
        res.json(response.data);
        
    } catch (error) {
        console.error('❌ Proxy GET Error:', error.message);
        
        let errorMessage = 'Terjadi kesalahan pada proxy';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Tidak dapat terhubung ke server ditss.biz.id';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = 'Timeout: Server ditss.biz.id tidak merespons';
        } else if (error.response) {
            errorMessage = `Server error: ${error.response.status} - ${error.response.statusText}`;
        }
        
        res.status(500).json({ 
            status: false,
            error: errorMessage,
            details: error.message
        });
    }
});

// Proxy untuk AI Edit Foto - POST requests dengan file upload
app.post('/api/proxy/editfoto2', async (req, res) => {
    try {
        const form = formidable({ 
            multiples: false,
            maxFileSize: 10 * 1024 * 1024 // 10MB
        });
        
        form.parse(req, async (err, fields, files) => {
            if (err) {
                return res.status(400).json({ 
                    status: false,
                    error: 'File upload failed: ' + err.message 
                });
            }
            
            const file = files.file?.[0];
            const prompt = fields.prompt?.[0];
            
            if (!file) {
                return res.status(400).json({ 
                    status: false,
                    error: 'File diperlukan' 
                });
            }
            
            if (!prompt) {
                return res.status(400).json({ 
                    status: false,
                    error: 'Prompt diperlukan' 
                });
            }
            
            try {
                console.log('🔁 Proxy POST: Forwarding file to ditss.biz.id', { 
                    filename: file.originalFilename,
                    size: file.size,
                    prompt: prompt.substring(0, 30) + '...' 
                });
                
                // Baca file sebagai buffer
                const fileBuffer = fs.readFileSync(file.filepath);
                
                // Buat FormData untuk dikirim ke ditss.biz.id
                const formData = new FormData();
                formData.append('file', fileBuffer, {
                    filename: file.originalFilename || 'image.jpg',
                    contentType: file.mimetype || 'image/jpeg'
                });
                formData.append('prompt', prompt);
                
                const response = await axios.post('https://ditss.biz.id/api/ai/editfoto2', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 60000
                });
                
                // Hapus file temporary
                try {
                    fs.unlinkSync(file.filepath);
                } catch (cleanupError) {
                    console.log('Cleanup warning:', cleanupError.message);
                }
                
                console.log('✅ Proxy POST: Success');
                res.json(response.data);
                
            } catch (axiosError) {
                console.error('❌ Axios Error:', axiosError.message);
                
                // Cleanup file temporary even on error
                try {
                    if (file && file.filepath) {
                        fs.unlinkSync(file.filepath);
                    }
                } catch (cleanupError) {
                    console.log('Cleanup warning:', cleanupError.message);
                }
                
                let errorMessage = 'Gagal terhubung ke layanan AI';
                if (axiosError.code === 'ECONNREFUSED') {
                    errorMessage = 'Tidak dapat terhubung ke server ditss.biz.id';
                } else if (axiosError.code === 'ETIMEDOUT') {
                    errorMessage = 'Timeout: Proses AI terlalu lama';
                } else if (axiosError.response) {
                    errorMessage = `Server error: ${axiosError.response.status} - ${axiosError.response.statusText}`;
                    if (axiosError.response.data && axiosError.response.data.error) {
                        errorMessage = axiosError.response.data.error;
                    }
                }
                
                res.status(500).json({ 
                    status: false,
                    error: errorMessage,
                    details: axiosError.message
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Proxy POST Error:', error.message);
        res.status(500).json({ 
            status: false,
            error: 'Server error: ' + error.message 
        });
    }
});

app.listen(port, () => {
  console.log(`Server running at ${APP_DOMAIN}`);
});
