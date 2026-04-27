import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import multer from "multer";
import axios from "axios";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
const PORT = 3000;

// Increase server timeout to 30 minutes
app.set('timeout', 1800000);

// Set global limits early
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Setup directories
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const OUTPUTS_DIR = path.join(process.cwd(), "outputs");
const TEMP_DIR = path.join(process.cwd(), "temp");
const FONTS_DIR = path.join(process.cwd(), "fonts");
const DATA_DIR = path.join(process.cwd(), "data");
const QURAN_DATA_DIR = path.join(DATA_DIR, "quran");

[UPLOADS_DIR, OUTPUTS_DIR, TEMP_DIR, FONTS_DIR, DATA_DIR, QURAN_DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  } else if (dir === TEMP_DIR || dir === UPLOADS_DIR || dir === OUTPUTS_DIR) {
    // Clear temp, uploads, and outputs on startup to free space
    const files = fs.readdirSync(dir);
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error(`Failed to delete ${file}:`, e);
      }
    }
  }
});

const ARABIC_FONT_PATH = path.join(FONTS_DIR, "Amiri-Regular.ttf");
const ENGLISH_FONT_PATH = path.join(FONTS_DIR, "Inter-SemiBold.ttf");
const CAIRO_FONT_PATH = path.join(FONTS_DIR, "Cairo-Regular.ttf");
const CAIRO_BOLD_FONT_PATH = path.join(FONTS_DIR, "Cairo-Bold.ttf");

// Helper to escape paths for FFmpeg filters (especially on Windows)
function escapeFFmpegPath(path: string) {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// Helper to convert #RRGGBB to 0xRRGGBB@Opacity
function toFfmpegColor(hex: string | undefined, opacityPercent: number | undefined = 100) {
  if (!hex) return 'white';
  const cleanHex = hex.replace('#', '');
  const alpha = (opacityPercent / 100).toFixed(2);
  return `0x${cleanHex}@${alpha}`;
}

async function ensureFontsExist() {
  const fonts = [
    {
      name: "Amiri",
      path: ARABIC_FONT_PATH,
      urls: [
        "https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf",
        "https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf"
      ]
    },
    {
      name: "Inter",
      path: ENGLISH_FONT_PATH,
      urls: [
        "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-SemiBold.ttf",
        "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter-SemiBold.ttf"
      ]
    },
    {
      name: "Cairo",
      path: CAIRO_FONT_PATH,
      urls: [
        "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/static/Cairo-Regular.ttf",
        "https://github.com/google/fonts/raw/main/ofl/cairo/static/Cairo-Regular.ttf"
      ]
    },
    {
      name: "CairoBold",
      path: CAIRO_BOLD_FONT_PATH,
      urls: [
        "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/static/Cairo-Bold.ttf",
        "https://github.com/google/fonts/raw/main/ofl/cairo/static/Cairo-Bold.ttf"
      ]
    }
  ];

  for (const font of fonts) {
    if (!fs.existsSync(font.path)) {
      console.log(`Downloading ${font.name} font...`);
      let success = false;
      for (const url of font.urls) {
        try {
          const response = await axios({
            url: url,
            method: "GET",
            responseType: "stream",
            timeout: 15000
          });
          
          if (response.status !== 200) {
            throw new Error(`Status code ${response.status}`);
          }

          const writer = fs.createWriteStream(font.path);
          response.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on("finish", () => resolve(undefined));
            writer.on("error", reject);
          });
          
          console.log(`${font.name} font downloaded successfully.`);
          success = true;
          break;
        } catch (error: any) {
          console.warn(`Attempt failed for ${font.name} from ${url}: ${error.message}`);
          if (fs.existsSync(font.path)) fs.unlinkSync(font.path); // Cleanup partial file
        }
      }
      if (!success) {
        console.error(`Critical: Could not download ${font.name} font from any source.`);
      }
    }
  }
}

// Pre-load essential data on startup
async function prefetchData() {
  console.log("Starting background pre-fetch of Quran data...");
  
  // 1. Fetch all surahs metadata
  const allMetaPath = path.join(QURAN_DATA_DIR, "all_surahs_meta.json");
  if (!fs.existsSync(allMetaPath)) {
    try {
      const res = await axios.get("https://api.alquran.cloud/v1/surah", { timeout: 15000 });
      fs.writeFileSync(allMetaPath, JSON.stringify(res.data), 'utf-8');
      console.log("All Surahs metadata cached.");
    } catch (e: any) {
      console.warn("Failed to fetch all surahs meta:", e.message);
    }
  }

  // 2. Fetch and cache all surahs (Slowly to avoid rate limits)
  // We'll queue them up
  const surahsToFetch = Array.from({ length: 114 }, (_, i) => (i + 1).toString());
  
  for (const id of surahsToFetch) {
    try {
      const arCachePath = path.join(QURAN_DATA_DIR, `surah_${id}_ar.json`);
      const enCachePath = path.join(QURAN_DATA_DIR, `surah_${id}_en.json`);
      const metaCachePath = path.join(QURAN_DATA_DIR, `meta_surah_${id}.json`);

      // Meta
      if (!fs.existsSync(metaCachePath)) {
        const res = await axios.get(`https://api.alquran.cloud/v1/surah/${id}`, { timeout: 10000 });
        fs.writeFileSync(metaCachePath, JSON.stringify(res.data), 'utf-8');
      }
      
      // Arabic
      if (!fs.existsSync(arCachePath)) {
        const res = await axios.get(`https://api.alquran.cloud/v1/surah/${id}/ar.alafasy`, { timeout: 10000 });
        fs.writeFileSync(arCachePath, JSON.stringify(res.data.data.ayahs), 'utf-8');
        // Small delay between surahs to be respectful
        await new Promise(r => setTimeout(r, 500));
      }
      
      // English
      if (!fs.existsSync(enCachePath)) {
        const res = await axios.get(`https://api.alquran.cloud/v1/surah/${id}/en.sahih`, { timeout: 10000 });
        fs.writeFileSync(enCachePath, JSON.stringify(res.data.data.ayahs), 'utf-8');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e: any) {
      console.warn(`Pre-fetch failed for Surah ${id}:`, e.message);
      // If we hit a rate limit, wait longer
      if (e.response?.status === 429) {
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  }
  console.log("Quran data pre-fetch task completed.");
}

// Initialize fonts and pre-fetch data
ensureFontsExist().then(() => {
  prefetchData();
});

// Multer setup for audio upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ 
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit for audio files
});

// Pexels Search API
app.get("/api/videos/search", async (req, res) => {
  try {
    const { query, per_page = 30, page = 1 } = req.query;
    const apiKey = process.env.PEXELS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "Pexels API key missing" });
    }

    const response = await axios.get(`https://api.pexels.com/videos/search`, {
      params: { 
        query, 
        per_page, 
        page,
        orientation: "landscape" 
      },
      headers: { Authorization: apiKey },
    });

    res.json(response.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

const downloadingFiles = new Map<string, { progress: number, status: string }>();

// Progress endpoint
app.get("/api/download-progress/:filename", (req, res) => {
  const { filename } = req.params;
  const info = downloadingFiles.get(filename);
  if (info) {
    res.json(info);
  } else {
    res.status(404).json({ status: "not_found" });
  }
});

// Download remote audio
app.post("/api/process-audio", async (req, res) => {
  const { audioFile, startTime, duration } = req.body;
  
  if (!audioFile) return res.status(400).json({ error: "audioFile is required" });
  
  const inputPath = path.join(UPLOADS_DIR, audioFile);
  if (!fs.existsSync(inputPath)) return res.status(404).json({ error: "File not found" });

  // Safety: ensure it's not still being downloaded
  const dInfo = downloadingFiles.get(audioFile);
  if (dInfo && dInfo.status !== 'completed') {
    return res.status(202).json({ error: "File still being downloaded", status: dInfo.status, progress: dInfo.progress });
  }

  try {
    const stats = fs.statSync(inputPath);
    if (stats.size === 0) {
      return res.status(202).json({ error: "File is empty/preparing" });
    }
  } catch (e) {
    return res.status(404).json({ error: "File inaccessible" });
  }

  const outputFilename = `processed_${uuidv4()}.mp3`;
  const outputPath = path.join(TEMP_DIR, outputFilename);
  
  try {
    const st = parseFloat(startTime) || 0;
    const dur = parseFloat(duration) || 0;
    console.log(`[ProcessAudio] Processing ${audioFile}: st=${st}, dur=${dur}`);
    
    const command = ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .toFormat('mp3');

    if (st > 0) command.setStartTime(st);
    if (dur > 0) command.setDuration(dur);

    await new Promise((resolve, reject) => {
      command.on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const fileContent = fs.readFileSync(outputPath);
    const base64 = fileContent.toString('base64');
    
    // Clean up
    fs.unlinkSync(outputPath);
    
    res.json({ base64, mimeType: 'audio/mpeg' });
  } catch (error: any) {
    console.error(`[ProcessAudio] Error:`, error.message);
    res.status(500).json({ error: "Processing failed", details: error.message });
  }
});

app.post("/api/download-audio", async (req, res) => {
  const { url, isEveryAyah, surah, ayahStart, ayahEnd } = req.body;
  console.log(`[Download Request Started] Raw URL received: "${url}" (EveryAyah: ${!!isEveryAyah})`);
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    let urlHash = crypto.createHash('sha256').update(url).digest('hex');
    
    // Unique name for range downloads
    if (isEveryAyah && surah && ayahStart && ayahEnd) {
      urlHash = crypto.createHash('sha256').update(`${url}_${surah}_${ayahStart}_${ayahEnd}`).digest('hex');
    }

    const filename = `${urlHash}.mp3`;
    const filePath = path.join(UPLOADS_DIR, filename);
    
    // Cache check + Check if already downloading
    if (downloadingFiles.has(filename)) {
      console.log(`[Download] Already in progress for: ${filename}`);
      return res.status(202).json({ filename, status: 'downloading' });
    }

    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
          console.log(`[Cache Hit] Serving existing file for: ${filename}`);
          let duration = 0;
          try {
            duration = await new Promise<number>((resolve) => {
              ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) resolve(0);
                else resolve(metadata.format.duration || 0);
              });
            });
          } catch (e) {}
          return res.json({ filename, duration, cached: true });
        } else {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
      } catch (e) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    
    downloadingFiles.set(filename, { progress: 0, status: 'downloading' });

    const downloadStream = async (dUrl: string, dPath: string) => {
      let dAttempts = 0;
      const dMaxAttempts = 3; // Reduced to fail faster but still retry
      while (dAttempts < dMaxAttempts) {
        try {
          dAttempts++;
          console.log(`[Download Sub] GET ${dUrl} (Att ${dAttempts}/${dMaxAttempts})`);
          const dRes = await axios({
            url: dUrl,
            method: "GET",
            responseType: "stream",
            timeout: 30000, // Reasonable timeout per ayah
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
          });
          const writer = fs.createWriteStream(dPath);
          await pipeline(dRes.data, writer);
          return;
        } catch (e: any) {
          const status = e.response?.status;
          console.warn(`[Download Sub Error] Att ${dAttempts} failed for ${dUrl}: ${e.message} (Status: ${status})`);
          if (dAttempts >= dMaxAttempts) throw e;
          await new Promise(r => setTimeout(r, 1000 * dAttempts));
        }
      }
    };
    
    try {
      if (isEveryAyah && surah && ayahStart && ayahEnd) {
        console.log(`[EveryAyah Process] Surah ${surah}: ${ayahStart}-${ayahEnd} requested for ${url}`);
        const ayahFiles: string[] = [];
        const baseDir = path.join(TEMP_DIR, `ea_${urlHash}`);
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        
        let serverCandidates = [url];
        
        let currentUrl = url;
        // Use EveryAyah format directly if it's a range request
        if (surah && ayahStart && ayahEnd && !currentUrl.endsWith('.mp3')) {
           // If URL is just a folder or base EveryAyah URL
           if (!currentUrl.endsWith('/')) currentUrl += '/';
           
           // Generate candidates: https/http with and without www
           // Extract the reciter directory from the URL (everything after /data/)
           let reciterDir = currentUrl;
           if (currentUrl.includes('/data/')) {
             reciterDir = currentUrl.split('/data/')[1];
           } else {
             // Fallback: strip domain
             reciterDir = currentUrl.replace(/^https?:\/\/[^\/]+\//, '');
           }
           
           const dataPath = reciterDir.startsWith('/') ? reciterDir.substring(1) : reciterDir;
           
           serverCandidates = [
             `https://www.everyayah.com/data/${dataPath}`,
             `http://www.everyayah.com/data/${dataPath}`,
             `https://everyayah.com/data/${dataPath}`,
             `http://everyayah.com/data/${dataPath}`
           ];
           
           // Deduplicate and cleanup
           serverCandidates = [...new Set(serverCandidates)].map(u => u.endsWith('/') ? u : `${u}/`);
           console.log(`[EveryAyah] Candidates for Surah ${surah}:`, serverCandidates);
        }

        const start = parseInt(ayahStart);
        const end = parseInt(ayahEnd);
        const total = end - start + 1;
        
        // Parallel download limited to 5 at a time
        const concurrency = 5;
        for (let i = start; i <= end; i += concurrency) {
          const batch = [];
          for (let j = 0; j < concurrency && (i + j) <= end; j++) {
            const ayahId = i + j;
            const aFile = `${String(surah).padStart(3, '0')}${String(ayahId).padStart(3, '0')}.mp3`;
            const aPath = path.join(baseDir, aFile);
            batch.push((async () => {
              let downloaded = false;
              let lastError = null;
              
              for (const base of serverCandidates) {
                try {
                  const targetUrl = base.endsWith('/') ? `${base}${aFile}` : `${base}/${aFile}`;
                  await downloadStream(targetUrl, aPath);
                  downloaded = true;
                  break;
                } catch (e: any) {
                  lastError = e;
                  continue; 
                }
              }
              
              if (!downloaded) {
                console.error(`[Ayah Download Failed] ${aFile}: ${lastError?.message}`);
                throw lastError || new Error(`Failed to download ${aFile} from all sources`);
              }
              
              ayahFiles.push(aPath);
              const progress = Math.round((ayahFiles.length / total) * 90);
              downloadingFiles.set(filename, { progress, status: 'downloading' });
            })());
          }
          await Promise.all(batch);
        }
        
        // Merge with ffmpeg using concat demuxer for better reliability
        console.log(`[EveryAyah] Merging ${ayahFiles.length} files...`);
        downloadingFiles.set(filename, { progress: 95, status: 'merging' });

        const concatFilePath = path.join(baseDir, 'concat_list.txt');
        const sortedFiles = ayahFiles.slice().sort((a, b) => {
          // Extract numeric part of filename to ensure correct order (e.g. 001001.mp3)
          const baseA = path.basename(a).replace(/\D/g, '');
          const baseB = path.basename(b).replace(/\D/g, '');
          return baseA.localeCompare(baseB);
        });
        
        // Create the concat command file
        const concatContent = sortedFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(concatFilePath, concatContent);

        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(concatFilePath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions('-c copy')
            .on('error', (err, stdout, stderr) => {
              console.error(`[FFMPEG Merge Error]`, err);
              console.error(`[FFMPEG Stderr]`, stderr);
              reject(err);
            })
            .on('end', () => {
              console.log(`[EveryAyah] Merge completed: ${filename}`);
              resolve(true);
            })
            .save(filePath);
        });
        
        // Cleanup sub-files
        try { fs.unlinkSync(concatFilePath); } catch (e) {}
        for (const f of ayahFiles) try { fs.unlinkSync(f); } catch (e) {}
        try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch (e) {}
      } else {
        console.log(`[Download] Starting direct stream from ${url}...`);
        await downloadStream(url, filePath);
      }

      // Final Probing
      let duration = 0;
      try {
        duration = await new Promise<number>((resolve) => {
          ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) resolve(0);
            else resolve(metadata.format.duration || 0);
          });
        });
      } catch (e) {}
      
      downloadingFiles.set(filename, { progress: 100, status: 'completed' });
      res.json({ filename, duration });
    } catch (error: any) {
      console.error(`[Download API Failure] ${error.message} ${error.response?.data ? JSON.stringify(error.response.data) : ''}`);
      if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (e) {}
      downloadingFiles.set(filename, { progress: 0, status: 'error' });
      res.status(500).json({ error: "Download failed", details: error.message, upstreamStatus: error.response?.status });
    } finally {
      // Clear status after 5s instead of 60s
      setTimeout(() => downloadingFiles.delete(filename), 5000);
    }
  } catch (outerError: any) {
    console.error(`[Download Outer Error] ${outerError.message}`);
    res.status(500).json({ error: "Server error", details: outerError.message });
  }
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("UNHANDLED GLOBAL ERROR:", err);
  res.status(500).json({ 
    error: "Internal Server Error", 
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Quran Text API (Proxy both Arabic and English)
app.get("/api/quran/verse", async (req, res) => {
  try {
    const { surah, verse, lang = 'ar.alafasy' } = req.query;
    const response = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${verse}/${lang}`);
    res.json(response.data);
  } catch (error: any) {
    console.error(`Quran API Error (${req.query.surah}:${req.query.verse}):`, error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Quran Surah Meta API with Caching
app.get("/api/quran/surah/:id", async (req, res) => {
  const { id } = req.params;
  
  // Special case: all surahs
  if (id === 'all') {
    const allMetaPath = path.join(QURAN_DATA_DIR, "all_surahs_meta.json");
    if (fs.existsSync(allMetaPath)) {
      return res.json(JSON.parse(fs.readFileSync(allMetaPath, 'utf-8')));
    }
    try {
      const response = await axios.get("https://api.alquran.cloud/v1/surah");
      fs.writeFileSync(allMetaPath, JSON.stringify(response.data), 'utf-8');
      return res.json(response.data);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const cachePath = path.join(QURAN_DATA_DIR, `meta_surah_${id}.json`);
  try {
    if (fs.existsSync(cachePath)) {
      return res.json(JSON.parse(fs.readFileSync(cachePath, 'utf-8')));
    }

    const response = await axios.get(`https://api.alquran.cloud/v1/surah/${id}`);
    fs.writeFileSync(cachePath, JSON.stringify(response.data), 'utf-8');
    res.json(response.data);
  } catch (error: any) {
    console.error(`Surah Meta Error (${id}):`, error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Application Config API (Donations & Socials)
app.get("/api/app-config", (req, res) => {
  try {
    const configPath = path.join(process.cwd(), "src", "config.json");
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      res.json(configData);
    } else {
      res.status(404).json({ error: "Config not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Quran Surah Range API with Local Caching (Arabic + English)
app.get("/api/quran/surah/:id/range", async (req, res) => {
  try {
    const { id } = req.params;
    const { start = 1, end = 7 } = req.query;
    
    const arCachePath = path.join(QURAN_DATA_DIR, `surah_${id}_ar.json`);
    const enCachePath = path.join(QURAN_DATA_DIR, `surah_${id}_en.json`);

    let arAyahs, enAyahs;

    // Load or Fetch Arabic
    try {
      if (fs.existsSync(arCachePath)) {
        arAyahs = JSON.parse(fs.readFileSync(arCachePath, 'utf-8'));
      } else {
        console.log(`Fetching Arabic Surah ${id} from API...`);
        const arRes = await axios.get(`https://api.alquran.cloud/v1/surah/${id}/ar.alafasy`, { timeout: 15000 });
        arAyahs = arRes.data.data.ayahs;
        fs.writeFileSync(arCachePath, JSON.stringify(arAyahs), 'utf-8');
      }
    } catch (e: any) {
      console.warn(`Arabic Surah ${id} fetch failed, checking cache:`, e.message);
      if (fs.existsSync(arCachePath)) {
        arAyahs = JSON.parse(fs.readFileSync(arCachePath, 'utf-8'));
      } else throw e;
    }

    // Load or Fetch English
    try {
      if (fs.existsSync(enCachePath)) {
        enAyahs = JSON.parse(fs.readFileSync(enCachePath, 'utf-8'));
      } else {
        console.log(`Fetching English Surah ${id} from API...`);
        const enRes = await axios.get(`https://api.alquran.cloud/v1/surah/${id}/en.sahih`, { timeout: 15000 });
        enAyahs = enRes.data.data.ayahs;
        fs.writeFileSync(enCachePath, JSON.stringify(enAyahs), 'utf-8');
      }
    } catch (e: any) {
      console.warn(`English Surah ${id} fetch failed, checking cache:`, e.message);
      if (fs.existsSync(enCachePath)) {
        enAyahs = JSON.parse(fs.readFileSync(enCachePath, 'utf-8'));
      } else throw e;
    }
    
    const s = parseInt(start as string);
    const e = parseInt(end as string);
    
    const range = arAyahs.slice(s - 1, e).map((ayah: any, idx: number) => ({
      number: ayah.numberInSurah,
      text: ayah.text,
      translation: enAyahs[s - 1 + idx]?.text || ""
    }));
    
    res.json({ data: range });
  } catch (error: any) {
    console.error("Quran Range Error:", error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Job tracking for long running generation
const jobs = new Map<string, { status: string, progress: number, url?: string, error?: string }>();

// Cleanup old jobs and files from memory and disk periodically
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  // Cleanup Jobs
  for (const [id, job] of jobs.entries()) {
    if (job.status === 'completed' || job.status === 'error') {
       jobs.delete(id);
    }
  }

  // Cleanup Files older than 1 hour
  [TEMP_DIR, UPLOADS_DIR, OUTPUTS_DIR].forEach(dir => {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > ONE_HOUR) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // Ignore errors (file might be in use)
        }
      }
    }
  });
}, 30 * 60 * 1000); // Run every 30 minutes

// Video Generation API (Asynchronous to prevent 502)
app.post("/api/generate", async (req, res) => {
  const { audioFile, videoClips, verses, settings } = req.body;
  const { dimensions = '16:9' } = settings || {};
  
  if (!audioFile) {
    return res.status(400).json({ error: "Audio file is missing. Please upload or select an audio file." });
  }

  const jobId = uuidv4();
  const outputFilename = `${jobId}.mp4`;
  const outputPath = path.join(OUTPUTS_DIR, outputFilename);
  const audioPath = path.join(UPLOADS_DIR, audioFile);

  // Initialize job status
  jobs.set(jobId, { status: 'starting', progress: 0 });
  
  // Return Job ID immediately to prevent 502
  res.json({ jobId });

  // Continue processing in background
  (async () => {
    const localClips: string[] = [];
    const tempTextFiles: string[] = [];
    
    try {
      if (!videoClips || videoClips.length === 0) throw new Error("No background videos selected");
      if (!fs.existsSync(audioPath)) throw new Error("Audio file not found");

      jobs.set(jobId, { status: 'analyzing', progress: 5 });

      // 1. Calculate durations 
      const audioDuration = await new Promise<number>((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata.format.duration || 0);
        });
      });

      const audioSettings = settings.audio;
      const finalAudioDuration = audioSettings?.duration > 0 
        ? audioSettings.duration 
        : (audioDuration - (audioSettings?.startTime || 0));
      
      // Use planned clips from client for consistency with preview
      const plannedClips: any[] = videoClips;
      
      // 2. Download clips (Optimized: only download unique clips)
      jobs.set(jobId, { status: 'downloading', progress: 10 });
      const uniqueClips = new Map<string, string>(); // URL -> LocalPath
      const finalClipsData: { path: string, duration: number }[] = [];
      
      // Step-by-step download to avoid flooding network and for better tracking
      for (let i = 0; i < plannedClips.length; i++) {
        const clip = plannedClips[i];
        if (!clip.url) continue;

        try {
          let localPath = uniqueClips.get(clip.url);
          if (!localPath) {
            localPath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);
            const writer = fs.createWriteStream(localPath);
            const response = await axios({ 
              url: clip.url, 
              method: 'GET', 
              responseType: 'stream', 
              timeout: 90000 // Increased to 90s for better reliability
            });
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
              writer.on('finish', () => resolve(undefined));
              writer.on('error', reject);
            });
            uniqueClips.set(clip.url, localPath);
            localClips.push(localPath);
          }
          finalClipsData.push({ path: localPath, duration: clip.duration });
          
          // Update download progress
          const downloadProgress = 10 + Math.floor((i / plannedClips.length) * 10);
          jobs.set(jobId, { status: 'downloading', progress: downloadProgress });
        } catch (dlErr: any) {
          let errorType = "Network Error";
          if (dlErr.code === 'ETIMEDOUT') errorType = "Timeout";
          else if (dlErr.response?.status === 404) errorType = "Not Found (404)";
          else if (dlErr.response?.status === 403) errorType = "Forbidden (403)";
          
          const errorMessage = `Failed to download background clip ${i + 1} (${errorType}): ${dlErr.message}`;
          console.error(errorMessage);
          
          if (plannedClips.length === 1 || i === 0) {
             throw new Error(errorMessage);
          }
          // If we have other clips, we might continue, but let's be strict for now as it affects quality
          throw new Error(errorMessage);
        }
      }

      if (finalClipsData.length === 0) throw new Error("Failed to download any video clips");

      jobs.set(jobId, { status: 'processing', progress: 20 });

      const command = ffmpeg();
      finalClipsData.forEach((clipData) => {
        command.input(clipData.path).inputOptions([`-t ${clipData.duration}`]);
      });
      
      // Add audio input with specific options to ensure trimming works
      const st = parseFloat(audioSettings?.startTime) || 0;
      const dur = parseFloat(audioSettings?.duration) || 0;

      command.input(audioPath);
      
      if (st > 0) {
        command.seekInput(st);
      }
      
      if (dur > 0) {
        command.inputOptions('-t', dur.toString());
      }
      
      const audioInputIndex = finalClipsData.length;

    // Apply audio settings if provided
    if (audioSettings) {
      const audioFilters = [];
      const effectiveDur = (parseFloat(audioSettings.duration) > 0) 
        ? parseFloat(audioSettings.duration) 
        : (audioDuration - (parseFloat(audioSettings.startTime) || 0));

      if (audioSettings.volume !== undefined && audioSettings.volume !== 1) {
        audioFilters.push(`volume=${audioSettings.volume}`);
      }
      if (audioSettings.fadeIn > 0) {
        audioFilters.push(`afade=t=in:st=0:d=${audioSettings.fadeIn}`);
      }
      if (audioSettings.fadeOut > 0) {
        const fadeOutStart = effectiveDur - audioSettings.fadeOut;
        if (fadeOutStart > 0) {
          audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${audioSettings.fadeOut}`);
        }
      }
      if (audioSettings.normalize) {
        audioFilters.push('loudnorm');
      }
      
      if (audioFilters.length > 0) {
        command.audioFilters(audioFilters);
      }
    }

    // Calculate verse timings based on audio duration if not provided accurately
    const effectiveAudioDuration = audioSettings?.duration || audioDuration;
    const verseCount = verses.length;
    const durationPerVerse = verseCount > 0 ? effectiveAudioDuration / verseCount : 0;

    // Overlays and output formatting
    const filters: any[] = [];
    
    // Normalize and prepare each video clip
    let renderHeight = 1080;
    let renderWidth = 1920;
    finalClipsData.forEach((_, i) => {
      const q = settings.quality || '1080p';
      let scaleOpts = '';
      if (dimensions === '16:9') {
        if (q === '4k') { scaleOpts = '3840:2160'; renderHeight = 2160; renderWidth = 3840; }
        else if (q === '2k') { scaleOpts = '2560:1440'; renderHeight = 1440; renderWidth = 2560; }
        else if (q === '1080p') { scaleOpts = '1920:1080'; renderHeight = 1080; renderWidth = 1920; }
        else { scaleOpts = '1280:720'; renderHeight = 720; renderWidth = 1280; }
      } else if (dimensions === '9:16') {
        if (q === '4k') { scaleOpts = '2160:3840'; renderHeight = 3840; renderWidth = 2160; }
        else if (q === '2k') { scaleOpts = '1440:2560'; renderHeight = 2560; renderWidth = 1440; }
        else if (q === '1080p') { scaleOpts = '1080:1920'; renderHeight = 1920; renderWidth = 1080; }
        else { scaleOpts = '720:1280'; renderHeight = 1280; renderWidth = 720; }
      } else if (dimensions === '1:1') {
        if (q === '4k') { scaleOpts = '3840:3840'; renderHeight = 3840; renderWidth = 3840; }
        else if (q === '2k') { scaleOpts = '2560:2560'; renderHeight = 2560; renderWidth = 2560; }
        else if (q === '1080p') { scaleOpts = '1080:1080'; renderHeight = 1080; renderWidth = 1080; }
        else { scaleOpts = '720:720'; renderHeight = 720; renderWidth = 720; }
      } else if (dimensions === '4:5') {
        if (q === '4k') { scaleOpts = '2160:2700'; renderHeight = 2700; renderWidth = 2160; }
        else if (q === '2k') { scaleOpts = '1440:1800'; renderHeight = 1800; renderWidth = 1440; }
        else if (q === '1080p') { scaleOpts = '1080:1350'; renderHeight = 1350; renderWidth = 1080; }
        else { scaleOpts = '720:900'; renderHeight = 900; renderWidth = 720; }
      }
      
      filters.push({
        filter: 'scale',
        options: `${scaleOpts}:force_original_aspect_ratio=increase`,
        inputs: `${i}:v`,
        outputs: `v${i}scaled`
      });
      
      filters.push({
        filter: 'crop',
        options: scaleOpts,
        inputs: `v${i}scaled`,
        outputs: `v${i}cropped`
      });
      
      filters.push({
        filter: 'setsar',
        options: '1',
        inputs: `v${i}cropped`,
        outputs: `v${i}sar`
      });
      
      filters.push({
        filter: 'fps',
        options: '25',
        inputs: `v${i}sar`,
        outputs: `v${i}fps`
      });

      filters.push({
        filter: 'format',
        options: 'yuv420p',
        inputs: `v${i}fps`,
        outputs: `v${i}final`
      });
    });

    if (localClips.length === 0) {
      throw new Error("Failed to process any video clips");
    }

    // Concatenate all normalized videos in the planned sequence
    filters.push({
      filter: 'concat',
      options: { n: finalClipsData.length, v: 1, a: 0 },
      inputs: finalClipsData.map((_, i) => `v${i}final`),
      outputs: 'vconcat'
    });

    let currentVInput = 'vconcat';

    // Apply Global Filter
    if (settings.filter && settings.filter !== 'none') {
      const f = settings.filter;
      const filterOut = 'vfiltered';
      
      if (f === 'grayscale') {
        filters.push({ filter: 'hue', options: 's=0', inputs: currentVInput, outputs: filterOut });
      } else if (f === 'sepia') {
        filters.push({ filter: 'colorchannelmixer', options: '.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', inputs: currentVInput, outputs: filterOut });
      } else if (f === 'cinematic') {
        filters.push({ filter: 'curves', options: 'preset=vintage', inputs: currentVInput, outputs: 'vcin1' });
        filters.push({ filter: 'eq', options: 'contrast=1.1:brightness=0.05:saturation=1.2', inputs: 'vcin1', outputs: filterOut });
      } else if (f === 'vintage') {
        filters.push({ filter: 'curves', options: 'preset=vintage', inputs: currentVInput, outputs: filterOut });
      } else if (f === 'warm') {
        filters.push({ filter: 'colorbalance', options: 'rs=.2:gs=.1:bs=-.1', inputs: currentVInput, outputs: filterOut });
      } else if (f === 'cool') {
        filters.push({ filter: 'colorbalance', options: 'rs=-.2:gs=-.1:bs=.2', inputs: currentVInput, outputs: filterOut });
      }
      
      currentVInput = filterOut;
    }

    // Apply Global Effect
    if (settings.effect && settings.effect !== 'none') {
      const e = settings.effect;
      const effectOut = 'veffected';
      
      if (e === 'vignette') {
        filters.push({ filter: 'vignette', options: 'angle=PI/4', inputs: currentVInput, outputs: effectOut });
      } else if (e === 'grain') {
        filters.push({ filter: 'noise', options: 'alls=20:allf=t+u', inputs: currentVInput, outputs: effectOut });
      } else if (e === 'blur') {
        filters.push({ filter: 'boxblur', options: '2:1', inputs: currentVInput, outputs: effectOut });
      } else if (e === 'glow') {
        filters.push({ filter: 'unsharp', options: '7:7:1.5:7:7:0.5', inputs: currentVInput, outputs: effectOut });
      }
      
      currentVInput = effectOut;
    }

    let lastOutput = currentVInput;
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      
      // Use provided timings if available, otherwise fallback to even distribution
      const startTime = v.startTime !== undefined ? v.startTime : (isNaN(i * durationPerVerse) ? 0 : i * durationPerVerse);
      const endTime = v.endTime !== undefined ? v.endTime : (isNaN((i + 1) * durationPerVerse) ? 0 : (i + 1) * durationPerVerse);
      
      // Apply resolution-independent scaling
      // We use the min dimension as a reference for font size to ensure consistency across orientations
      const referenceDimension = Math.min(renderWidth, renderHeight);
      const arFontSize = Math.floor((settings.fontSize || 16) * (referenceDimension / 400)); // 16 is now the new base default
      const enFontSize = Math.floor(arFontSize * 0.55);
      const hasTranslation = !!v.translation;

      // Wrap text based on width - use margin and independent wrap limits
      const marginRatio = 1 - ((settings.textMargin !== undefined ? settings.textMargin : 6) * 2 / 100);
      const baseAvailableWidth = renderWidth * marginRatio;
      
      const arAvailableWidth = baseAvailableWidth * ((settings.arWrapLimit ?? 100) / 100);
      const enAvailableWidth = baseAvailableWidth * ((settings.enWrapLimit ?? 100) / 100);

      // Scale padding: 96px total (px-12 in tailwind is 48px per side)
      const paddingX = 96 * (referenceDimension / 1080);
      
      const arWidthForChars = Math.max(10, arAvailableWidth - paddingX);
      const enWidthForChars = Math.max(10, enAvailableWidth - paddingX);
      
      // Adjusted multipliers to match CSS wrapping more closely
      // Amiri (Arabic) characters and Inter (English) scaling
      const arMaxWidthChars = Math.floor(arWidthForChars / (arFontSize * 0.48));
      const enMaxWidthChars = Math.floor(enWidthForChars / (enFontSize * 0.58));
      
      const wrappedArText = wrapText(v.text, arMaxWidthChars);
      const wrappedEnText = v.translation ? wrapText(v.translation, enMaxWidthChars) : "";

      const arLinesCount = wrappedArText.split('\n').length;
      const enLinesCount = wrappedEnText.split('\n').length;
      
      // Vertical Positioning Logic - Relative to screen height
      const arCoordX = settings.textPosition?.x !== undefined ? 
                      Math.floor(settings.textPosition.x * renderWidth) : 
                      Math.floor(renderWidth / 2);
      
      const arCoordY = settings.textPosition?.y !== undefined ? 
                      Math.floor(settings.textPosition.y * renderHeight) : 
                      Math.floor(renderHeight * 0.40); // 40% from top

      const enCoordX = settings.translationPosition?.x !== undefined ? 
                      Math.floor(settings.translationPosition.x * renderWidth) : 
                      Math.floor(renderWidth / 2);

      const enCoordY = settings.translationPosition?.y !== undefined ? 
                      Math.floor(settings.translationPosition.y * renderHeight) : 
                      Math.floor(renderHeight * 0.75); // 75% from top

      // Arabic Text
      const arTextPath = path.join(TEMP_DIR, `ar_${uuidv4()}.txt`);
      fs.writeFileSync(arTextPath, wrappedArText);
      tempTextFiles.push(arTextPath);

      // Define animation expressions
      let arAlpha = '1';
      let arY = `${arCoordY}-th/2`;
      let arX = `${arCoordX}-tw/2`;
      const animDuration = 0.6;

      if (settings.animationPreset === 'fade') {
        arAlpha = `if(lt(t,${startTime}+${animDuration}),(t-${startTime})/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
      } else if (settings.animationPreset === 'slide-up') {
        arAlpha = `if(lt(t,${startTime}+${animDuration}),(t-${startTime})/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
        arY = `if(lt(t,${startTime}+${animDuration}),${arCoordY}-th/2 + 30*(1-(t-${startTime})/${animDuration}),${arCoordY}-th/2)`;
      } else if (settings.animationPreset === 'zoom') {
        // Zoom is hard in pure drawtext without scale filter, so we'll approximate with alpha and small Y shift
        arAlpha = `if(lt(t,${startTime}+${animDuration}),(t-${startTime})/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
        arY = `if(lt(t,${startTime}+${animDuration}),${arCoordY}-th/2 + 10*(1-(t-${startTime})/${animDuration}),${arCoordY}-th/2)`;
      } else if (settings.animationPreset === 'typewriter') {
        // Approximate typewriter using alpha
        arAlpha = `if(lt(t,${startTime}+${animDuration}),(t-${startTime})/${animDuration},1)`;
      }

      const arOut = `varabic${i}`;
      filters.push({
        filter: 'drawtext',
        options: {
          textfile: escapeFFmpegPath(arTextPath),
          fontfile: escapeFFmpegPath(ARABIC_FONT_PATH),
          fontcolor: toFfmpegColor(settings.arColor, 100),
          fontsize: arFontSize,
          line_spacing: Math.floor(arFontSize * ((settings.lineSpacing ?? 1.6) - 1)),
          shadowcolor: 'black@0.6',
          shadowx: 2,
          shadowy: 2,
          borderw: 2,
          bordercolor: settings.showBorder ? toFfmpegColor('#D4AF37', 50) : 'black@0.3',
          box: 1,
          boxcolor: toFfmpegColor(settings.boxColor, settings.boxOpacity),
          boxborderw: Math.floor(48 * (referenceDimension / 1080)),
          x: arX,
          y: arY,
          alpha: arAlpha,
          enable: `between(t,${startTime},${endTime})`
        },
        inputs: lastOutput,
        outputs: arOut
      });
      lastOutput = arOut;

      // English Translation
      if (hasTranslation && settings.showTranslation !== false) {
        const enTextPath = path.join(TEMP_DIR, `en_${uuidv4()}.txt`);
        fs.writeFileSync(enTextPath, wrappedEnText);
        tempTextFiles.push(enTextPath);

        let enAlpha = '1';
        let enY = `${enCoordY}-th/2`;
        if (settings.animationPreset === 'fade') {
          enAlpha = `if(lt(t,${startTime}+${animDuration}+0.2),(t-${startTime}-0.2)/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
        } else if (settings.animationPreset === 'slide-up') {
          enAlpha = `if(lt(t,${startTime}+${animDuration}+0.2),(t-${startTime}-0.2)/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
          enY = `if(lt(t,${startTime}+${animDuration}+0.2),${enCoordY}-th/2 + 20*(1-(t-${startTime}-0.2)/${animDuration}),${enCoordY}-th/2)`;
        } else if (settings.animationPreset === 'zoom') {
          enAlpha = `if(lt(t,${startTime}+${animDuration}+0.2),(t-${startTime}-0.2)/${animDuration},if(gt(t,${endTime}-${animDuration}),(${endTime}-t)/${animDuration},1))`;
          enY = `if(lt(t,${startTime}+${animDuration}+0.2),${enCoordY}-th/2 + 5*(1-(t-${startTime}-0.2)/${animDuration}),${enCoordY}-th/2)`;
        }

        const enOut = `venglish${i}`;
        filters.push({
          filter: 'drawtext',
          options: {
            textfile: escapeFFmpegPath(enTextPath),
            fontfile: escapeFFmpegPath(ENGLISH_FONT_PATH), 
            fontcolor: toFfmpegColor(settings.enColor, 80),
            fontsize: enFontSize,
            line_spacing: Math.floor(enFontSize * ((settings.lineSpacing ?? 1.6) - 1.1)),
            shadowcolor: 'black@0.5',
            shadowx: 1,
            shadowy: 1,
            borderw: 1,
            bordercolor: settings.showBorder ? toFfmpegColor('#D4AF37', 40) : 'black@0.3',
            box: 1,
            boxcolor: toFfmpegColor(settings.boxColor, settings.boxOpacity),
            boxborderw: Math.floor(48 * (referenceDimension / 1080)),
            x: `${enCoordX}-tw/2`,
            y: enY,
            alpha: enAlpha,
            enable: `between(t,${startTime},${endTime})`
          },
          inputs: lastOutput,
          outputs: enOut
        });
        lastOutput = enOut;
      }

      // Citation Text (Surah: Ayah)
      if (v.surahName && v.number && settings.showCitation !== false) {
        const citationText = `[${v.surahName}: ${v.number}]`;
        const citeTextPath = path.join(TEMP_DIR, `cite_${uuidv4()}.txt`);
        fs.writeFileSync(citeTextPath, citationText);
        tempTextFiles.push(citeTextPath);

        const citeOut = `vcitate${i}`;
        const citeFontSize = Math.floor(enFontSize * 0.85);
        filters.push({
          filter: 'drawtext',
          options: {
            textfile: escapeFFmpegPath(citeTextPath),
            fontfile: escapeFFmpegPath(ARABIC_FONT_PATH),
            fontcolor: toFfmpegColor(settings.citationColor, 90), 
            fontsize: citeFontSize,
            x: `${arCoordX}-tw/2`,
            y: `h * 0.9 - th/2`,
            enable: `between(t,${startTime},${endTime})`
          },
          inputs: lastOutput,
          outputs: citeOut
        });
        lastOutput = citeOut;
      }
    }

    command
      .complexFilter(filters, lastOutput)
      .outputOptions([
        '-c:v libx264',
        '-preset ultrafast', // Fastest encoding speed
        '-threads 0',        // Use all available CPU cores
        '-pix_fmt yuv420p',
        '-map ' + audioInputIndex + ':a',
        '-shortest',
        '-movflags +faststart'
      ])
      .on('start', (cmd) => {
        console.log('FFmpeg started');
        jobs.set(jobId, { status: 'processing', progress: 20 });
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          const currentProgress = 20 + (Math.floor(progress.percent) * 0.8);
          jobs.set(jobId, { status: 'processing', progress: Math.min(99, currentProgress) });
          console.log(`Processing Job ${jobId}: ${Math.floor(progress.percent)}%`);
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`Job ${jobId} Error:`, err.message);
        console.error(`FFmpeg stderr:`, stderr);
        localClips.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
        tempTextFiles.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
        
        let userError = err.message;
        if (stderr) {
          if (stderr.includes('filter')) userError = "Video processing filter error. This usually happens with too many verses/clips. Try a shorter duration.";
          else if (stderr.includes('Permission denied')) userError = "File system permission error on the server.";
          else if (stderr.includes('No space left on device')) userError = "Server storage is full. Please try again later.";
          else if (stderr.includes('Invalid data found')) userError = "One of the video clips has a corrupted format or invalid data.";
          else if (stderr.includes('Error while opening encoder')) userError = "Video encoding error. The selected quality or format might be unsupported.";
          else if (stderr.includes('Out of memory')) userError = "Server ran out of memory during processing. Try lower quality (1080p).";
          else if (stderr.includes('Protocol not found')) userError = "Invalid video clip source protocol.";
          else {
            // Include a small portion of stderr if it seems useful but not too large
            const lastLines = stderr.split('\n').slice(-3).join(' ').trim();
            if (lastLines) userError = `Processing Error: ${lastLines}`;
          }
        }
        
        console.error(`Detailed Job ${jobId} FFmpeg Stderr:`, stderr);
        jobs.set(jobId, { status: 'error', progress: 0, error: userError });
      })
      .on('end', () => {
        console.log(`Job ${jobId} finished`);
        localClips.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
        tempTextFiles.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
        jobs.set(jobId, { status: 'completed', progress: 100, url: `/outputs/${outputFilename}` });
      })
      .save(outputPath);

    } catch (error: any) {
      console.error(`Job ${jobId} Initial error:`, error.message);
      localClips.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
      tempTextFiles.forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
      jobs.set(jobId, { status: 'error', progress: 0, error: error.message });
    }
  })();
});

// Job Status Polling
app.get("/api/generate/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.post("/api/upload", (req, res) => {
  upload.single("audio")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer Error:", err);
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      console.error("Unknown Upload Error:", err);
      return res.status(500).json({ error: `Upload failed: ${err.message}` });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Audio uploaded successfully:", req.file.filename);
    res.json({ filename: req.file.filename });
  });
});

function wrapText(text: string, maxWidthChars: number) {
  const words = text.split(' ');
  let lines = [];
  let currentLine = '';

  words.forEach(word => {
    if ((currentLine + word).length <= maxWidthChars) {
      currentLine += (currentLine === '' ? '' : ' ') + word;
    } else {
      if (currentLine !== '') lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine !== '') lines.push(currentLine);
  return lines.join('\n');
}

// Quran Storage Status (Check bundling progress)
app.get("/api/storage-status", (req, res) => {
  const fonts = fs.readdirSync(FONTS_DIR).length;
  const quranFiles = fs.readdirSync(QURAN_DATA_DIR).length;
  const isAllMeta = fs.existsSync(path.join(QURAN_DATA_DIR, "all_surahs_meta.json"));
  
  res.json({
    fonts: {
      count: fonts,
      location: FONTS_DIR
    },
    quran: {
      cachedFiles: quranFiles,
      fullMeta: isAllMeta,
      targetSurahs: 114,
      totalExpectedFiles: 114 * 3 + 1 // meta, ar, en for each + all_meta
    }
  });
});
// Dedicated download route to bypass iframe cookie/auth issues
app.get("/api/download/:filename", (req, res) => {
  let filename = req.params.filename;
  if (!filename.toLowerCase().endsWith('.mp4')) {
    filename += '.mp4';
  }
  const filePath = path.join(OUTPUTS_DIR, filename);

  if (fs.existsSync(filePath)) {
    console.log(`Starting download for: ${filename}`);
    // Explicitly set headers to force download behavior
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="Quran_Video_${filename}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (error) => {
      console.error('File stream error:', error);
      if (!res.headersSent) res.status(500).send("Error streaming file");
    });
    fileStream.pipe(res);
  } else {
    console.error(`File not found: ${filePath}`);
    res.status(404).send("File not found");
  }
});

// Support Message API
app.post("/api/support/message", async (req, res) => {
  const { name, email, message, subject } = req.body;
  const targetEmail = "alaa0102494@gmail.com";
  
  console.log("SUPPORT MESSAGE RECEIVED:");
  console.log(`From: ${name} <${email}>`);
  console.log(`Subject: ${subject}`);
  console.log(`Message: ${message}`);
  
  // Nodemailer Transport Configuration
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: (process.env.SMTP_PORT === '465' || !process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    // If SMTP credentials are provided, try sending the actual email
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: `"${name}" <${process.env.SMTP_USER}>`,
        to: targetEmail,
        replyTo: email,
        subject: `[Quran Video Support] ${subject}: ${name}`,
        text: `You have received a new support message:\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #D4AF37;">New Support Message</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr style="border: 0; border-top: 1px solid #eee;" />
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
        `,
      });
      console.log("SUCCESS: Support email sent to", targetEmail);
      res.json({ success: true, message: "Thank you for your message. We will get back to you soon." });
    } else {
      console.warn("WARNING: SMTP credentials (SMTP_USER/SMTP_PASS) are missing in environment variables.");
      console.warn("The message was received but NOT sent to email.");
      res.json({ 
        success: true, 
        warning: "SMTP_NOT_CONFIGURED",
        message: "Your message has been received by the system. (Admin notice: Please configure SMTP credentials to receive emails)." 
      });
    }
  } catch (error: any) {
    console.error("Error sending support email:", error);
    // Even if email fails, we return success to the user so they don't get stuck, 
    // but log the error on the server.
    res.json({ success: true, warning: "Message recorded but email failed to send.", message: "Thank you for your message." });
  }
});

// Middleware to serve static files with logging
const serveStaticWithLogging = (root: string) => {
  return async (req: any, res: any, next: any) => {
    const filename = req.path.startsWith('/') ? req.path.slice(1) : req.path;
    const filePath = path.join(root, filename);
    
    // Safety check for path traversal
    if (!filePath.startsWith(root)) {
      return res.status(403).send("Forbidden");
    }

    try {
      if (fs.existsSync(filePath)) {
        const stats = await fs.promises.stat(filePath);
        if (stats.size === 0) {
          console.warn(`[Static] File ${req.path} is empty, might still be writing.`);
          return res.status(202).send("File still being prepared"); 
        }
        
        console.log(`[Static] Serving: ${req.path} from ${root} (${stats.size} bytes)`);
        res.sendFile(filePath, (err: any) => {
          if (err) {
            // Check for common connection issues that aren't server errors
            if (err.code === 'ECONNABORTED' || err.syscall === 'write' || err.message?.includes('aborted')) {
               return;
            }
            console.error(`[Static] Error sending file ${req.path}:`, err.message);
            if (!res.headersSent) next(err);
          }
        });
      } else {
        next(); // Pass to next middleware
      }
    } catch (e: any) {
      if (e.code === 'ENOENT') return next();
      console.error(`[Static] Critical server error for ${req.path}:`, e.message);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  };
};

async function startServer() {
  // Static routes with specialized logging to debug 500 errors
  app.use("/uploads", serveStaticWithLogging(UPLOADS_DIR));
  app.use("/outputs", serveStaticWithLogging(OUTPUTS_DIR));
  app.use("/fonts", express.static(FONTS_DIR));
  app.use("/data", express.static(DATA_DIR));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  
  // Set server timeout to 30 minutes for long audio/video processing
  server.timeout = 1800000; 
  server.keepAliveTimeout = 1800000;
}

startServer();
