/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Search, 
  Video, 
  Download, 
  Plus, 
  Trash2, 
  Play, 
  BookOpen,
  Moon, 
  Sun, 
  Globe,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  RotateCcw,
  Scissors,
  Volume2,
  Sparkles,
  Zap,
  Pause,
  Type as TypeIcon,
  Facebook,
  Youtube,
  Instagram,
  Music2,
  Building2,
  Smartphone,
  CreditCard,
  Heart,
  ExternalLink,
  Copy,
  LifeBuoy,
  Mail,
  X
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AppSettings, VideoClip, Verse } from './types';
import { SURAH_LIST } from './constants';
import axios from 'axios';
import { GoogleGenAI, Type as AIType } from "@google/genai";

const normalizeArabic = (text: string) => {
  if (!text) return "";
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ًٌٍَُِّْ]/g, "") // Remove Tashkeel
    .toLowerCase()
    .trim();
};

const hexToRgba = (hex: string, opacity: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

const bufferToWave = (abuffer: AudioBuffer, len: number) => {
  const numOfChan = abuffer.numberOfChannels;
  const length = len * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  for (i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

async function trimAudioBlob(blob: Blob, startTime: number, duration: number): Promise<Blob> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const targetSampleRate = 16000; // Optimization: downsample for AI
  const realDuration = duration || (audioBuffer.duration - startTime);
  const frameCount = Math.floor(realDuration * targetSampleRate);

  const offlineContext = new OfflineAudioContext(
    1, // Optimization: mono is enough for AI
    frameCount,
    targetSampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0, startTime, realDuration);

  const renderedBuffer = await offlineContext.startRendering();
  return bufferToWave(renderedBuffer, frameCount);
}

const IconComponent = ({ name, size = 18, className = "" }: { name: string, size?: number, className?: string }) => {
  const icons:Record<string, any> = { 
    Youtube, Facebook, Instagram, Music2, Building2, Smartphone, CreditCard, Heart, ExternalLink, 
    LifeBuoy, Mail, X, Scissors, Volume2, Search, Video, Download, BookOpen, RefreshCw, Zap
  };
  const Component = icons[name] || Heart;
  if (!Component) return null;
  return <Component size={size} className={className} />;
};

export default function App() {
  const [step, setStep] = useState(1);
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [surah, setSurah] = useState("1");
  const [surahSearch, setSurahSearch] = useState("");
  const [versesRange, setVersesRange] = useState({ start: 1, end: 7 });
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [videoSearchQuery, setVideoSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VideoClip[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTrimmingPreviewPlaying, setIsTrimmingPreviewPlaying] = useState(false);
  const trimmingAudioRef = useRef<HTMLAudioElement>(null);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPositioningMode, setIsPositioningMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<'ar' | 'en'>('ar');
  const [previewTime, setPreviewTime] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [isSurahExplorerOpen, setIsSurahExplorerOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [selectedReciter, setSelectedReciter] = useState<any>(null);
  const [surahForAyahSelection, setSurahForAyahSelection] = useState<any>(null);
  const [ayahRange, setAyahRange] = useState({ start: 1, end: 7 });

  const RECITERS_LIST = [
    { name: "مشاري راشد العفاسي", dir: "Alafasy_128kbps" },
    { name: "عبد الباسط عبد الصمد (مرتل)", dir: "Abdul_Basit_Murattal_192kbps" },
    { name: "عبد الباسط عبد الصمد (مجود)", dir: "Abdul_Basit_Mujawwad_128kbps" },
    { name: "محمد صديق المنشاوي (مرتل)", dir: "Minshawy_Murattal_128kbps" },
    { name: "محمد صديق المنشاوي (مجود)", dir: "Minshawy_Mujawwad_64kbps" },
    { name: "محمود خليل الحصري", dir: "Husary_128kbps" },
    { name: "خليل الحصري (مرتل)", dir: "Khalil_Al-Husary_128kbps" },
    { name: "ماهر المعيقلي", dir: "Maher_AlMuaiqly_64kbps" },
    { name: "عبد الرحمن السديس", dir: "Abdurrahmaan_As-Sudais_192kbps" },
    { name: "سعود الشريم", dir: "Saud_as-Shuraym_128kbps" },
    { name: "أحمد العجمي", dir: "Ahmed_ibn_Ali_al-Ajamy_128kbps" },
    { name: "سعد الغامدي", dir: "Ghamadi_40kbps" },
    { name: "ياسر الدوسري", dir: "Yasser_Ad-Dussary_128kbps" },
    { name: "ناصر القطامي", dir: "Nasser_Alqatami_128kbps" },
    { name: "محمد أيوب", dir: "Muhammad_Ayyoub_128kbps" },
    { name: "محمد جبريل", dir: "Muhammad_Jibreel_128kbps" },
    { name: "صلاح البدير", dir: "Salah_Al_Budair_128kbps" },
    { name: "عبد الله بصفر", dir: "Abdullah_Basfar_128kbps" },
  ];

  const [isDetectingAI, setIsDetectingAI] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isIbanModalOpen, setIsIbanModalOpen] = useState(false);
  const [isSendingSupport, setIsSendingSupport] = useState(false);
  const [supportForm, setSupportForm] = useState({
    name: '',
    email: '',
    subject: 'Report a Problem',
    message: ''
  });
  const [appConfig, setAppConfig] = useState<{donations: any[], socials: any[]}>({ donations: [], socials: [] });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await axios.get('/api/app-config');
        setAppConfig(res.data);
      } catch (err) {
        console.error("Failed to load app config", err);
      }
    };
    fetchConfig();
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(settings.language === 'ar' ? 'تم النسخ بنجاح' : 'Copied successfully', {
      style: {
        background: '#151619',
        color: '#D4AF37',
        border: '1px solid rgba(212, 175, 55, 0.2)'
      }
    });
  };

  const handleSendSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportForm.message) {
      toast.error(settings.language === 'ar' ? 'يرجى كتابة رسالة أولاً' : 'Please write a message first');
      return;
    }
    
    setIsSendingSupport(true);
    try {
      await axios.post('/api/support/message', supportForm);
      toast.success(settings.language === 'ar' ? 'تم إرسال رسالتك بنجاح' : 'Your message has been sent successfully', {
        description: settings.language === 'ar' ? 'سنقوم بالرد عليك في أقرب وقت ممكن.' : 'We will get back to you as soon as possible.'
      });
      setSupportForm(prev => ({ ...prev, message: '' }));
      setIsSupportModalOpen(false);
    } catch (err) {
      console.error("Support failed", err);
      toast.error(settings.language === 'ar' ? 'فشل إرسال الرسالة. يرجى المحاولة مرة أخرى.' : 'Failed to send message. Please try again.');
    } finally {
      setIsSendingSupport(false);
    }
  };

  const [settings, setSettings] = useState<AppSettings>({
    fontSize: 16,
    theme: 'dark',
    language: 'ar',
    quality: '1080p',
    dimensions: '16:9',
    filter: 'none',
    effect: 'none',
    textMargin: 0,
    arColor: '#ffffff',
    enColor: '#ffffff',
    boxColor: '#000000',
    boxOpacity: 0,
    showTranslation: true,
    showCitation: true,
    citationColor: '#D4AF37',
    showBorder: true,
    arWrapLimit: 135,
    enWrapLimit: 100,
    lineSpacing: 1.4,
    textPosition: { x: 0.5, y: 0.5 },
    translationPosition: { x: 0.5, y: 0.8 },
    audio: { 
      startTime: 0, 
      duration: 0,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      normalize: false
    }
  });

  // High-frequency preview timer
  useEffect(() => {
    let rafId: number;
    const updateTime = () => {
      const audio = document.getElementById('preview-audio') as HTMLAudioElement;
      if (audio && !audio.paused) {
        const relativeTime = audio.currentTime - (settings.audio?.startTime || 0);
        setPreviewTime(relativeTime);
        rafId = requestAnimationFrame(updateTime);
      }
    };

    if (isPreviewPlaying) {
      rafId = requestAnimationFrame(updateTime);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPreviewPlaying, settings.audio?.startTime]);

  useEffect(() => {
    if (isSurahExplorerOpen || isLibraryOpen) {
      document.body.classList.add('no-scroll');
    } else {
      document.body.classList.remove('no-scroll');
    }
    return () => document.body.classList.remove('no-scroll');
  }, [isSurahExplorerOpen, isLibraryOpen]);

  useEffect(() => {
    const defaultSizes: Record<string, number> = {
      '16:9': 16,
      '9:16': 16,
      '1:1': 16,
      '4:5': 16
    };
    const currentIsDefault = [16].includes(settings.fontSize);
    const targetSize = defaultSizes[settings.dimensions];
    if (currentIsDefault && targetSize) {
       setSettings(s => ({ ...s, fontSize: targetSize }));
    }
  }, [settings.dimensions]);

  useEffect(() => {
    if (!previewRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPreviewHeight(entry.contentRect.height);
        setPreviewWidth(entry.contentRect.width);
      }
    });
    obs.observe(previewRef.current);
    return () => obs.disconnect();
  }, [step]);

  const getTargetHeight = () => {
    const baseHeight = {
      '720p': 720,
      '1080p': 1080,
      '2k': 1440,
      '4k': 2160
    }[settings.quality] || 1080;

    switch(settings.dimensions) {
      case '9:16': return Math.round(baseHeight * 16/9);
      case '4:5': return Math.round(baseHeight * 5/4);
      default: return baseHeight;
    }
  };

  const getVisualFontSize = (baseSize: number) => {
    if (!previewWidth || !previewHeight) return baseSize;
    const refDim = Math.min(previewWidth, previewHeight);
    return (baseSize / 400) * refDim;
  };

  const getFilterStyle = () => {
    let filter = '';
    switch(settings.filter) {
      case 'grayscale': filter += 'grayscale(100%) '; break;
      case 'sepia': filter += 'sepia(100%) '; break;
      case 'vintage': filter += 'sepia(0.5) contrast(1.2) brightness(0.9) '; break;
      case 'cinematic': filter += 'contrast(1.2) saturate(1.1) brightness(1.1) '; break;
      case 'warm': filter += 'sepia(0.2) saturate(1.3) hue-rotate(-10deg) '; break;
      case 'cool': filter += 'saturate(0.9) hue-rotate(10deg) brightness(1.1) '; break;
    }
    if (settings.effect === 'blur') filter += 'blur(2px) ';
    if (settings.effect === 'glow') filter += 'brightness(1.2) contrast(1.1) ';
    return filter || 'none';
  };

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  const toggleTheme = () => {
    setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));
  };

  const toggleLanguage = () => {
    setSettings(s => ({ ...s, language: s.language === 'ar' ? 'en' : 'ar' }));
  };

  const moveElement = (dir: 'up' | 'down' | 'left' | 'right') => {
    const stepSize = 0.02;
    setSettings(s => {
      const posKey = selectedElement === 'ar' ? 'textPosition' : 'translationPosition';
      const defaultPos = selectedElement === 'ar' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 0.8 };
      const current = s[posKey] || defaultPos;
      let { x, y } = current;
      
      switch(dir) {
        case 'up': y -= stepSize; break;
        case 'down': y += stepSize; break;
        case 'left': x -= stepSize; break;
        case 'right': x += stepSize; break;
      }
      
      return {
        ...s,
        [posKey]: { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
      };
    });
  };

  const handleRemoteAudioSelect = async (url: string, surahId?: number, range?: { start: number, end: number }) => {
    setIsUploading(true);
    setUploadProgress(0);
    console.log(`DEBUG: Target Audio URL to download: "${url}" (Range: ${surahId ? `${surahId}:${range?.start}-${range?.end}` : 'Full'})`);
    try {
      let response: any;
      let postRetries = 0;
      const maxPostRetries = 20;
      
      const payload: any = { url };
      if (surahId && range) {
        payload.isEveryAyah = true;
        payload.surah = surahId;
        payload.ayahStart = range.start;
        payload.ayahEnd = range.end;
      }
      
      // We'll also need to track the filename to poll progress
      // The first request will return the filename if it's already in progress or starting
      let filenameForPolling: string | null = null;
      
      const pollProgress = async (name: string) => {
        try {
          const res = await axios.get(`/api/download-progress/${name}`);
          if (res.data && res.data.progress !== undefined) {
             setUploadProgress(res.data.progress);
             return res.data.status;
          }
        } catch (e) {
          // Progress probably finished or not found
        }
        return 'unknown';
      };

      let downloadCompleted = false;
      while (postRetries < maxPostRetries) {
        try {
          response = await axios.post("/api/download-audio", payload);
          
          if (response.status === 202) {
            filenameForPolling = response.data.filename;
            if (filenameForPolling) {
              await pollProgress(filenameForPolling);
            }
            console.log(`Download in progress, waiting... (Attempt ${postRetries + 1})`);
            await new Promise(r => setTimeout(r, 2000));
            postRetries++;
            continue;
          }
          
          downloadCompleted = true;
          break;
        } catch (postError: any) {
          // If we have a filename, try to check status anyway
          if (filenameForPolling) {
            const status = await pollProgress(filenameForPolling);
            if (status === 'completed') {
              // Retry the post once more to get the final data
              continue;
            }
          }
          throw postError;
        }
      }
      
      if (!downloadCompleted) {
        throw new Error("Timeout waiting for parallel download to complete.");
      }

      setUploadProgress(100);
      setAudioFile(response.data.filename);
      const audioDuration = Math.round((response.data.duration || 0) * 100) / 100;
      
      // Update surah and verses range if provided
      if (surahId && range) {
        setSurah(String(surahId));
        setVersesRange({ start: range.start, end: range.end });
      }
      
      // Update settings with new audio URL
      setSettings(s => ({
        ...s,
        audio: {
          url: `/uploads/${response.data.filename}`,
          startTime: 0,
          duration: audioDuration,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          normalize: false
        }
      }));
      
      // Pre-fetch blob for AI analysis with retry (file system might lag)
      let audioBlobData = null;
      let blobRetries = 0;
      const maxBlobRetries = 10;
      
      // Initial small wait to let file system settle if it wasn't cached
      if (!response.data.cached) {
        await new Promise(r => setTimeout(r, 1000));
      }
      
      while (blobRetries < maxBlobRetries) {
        try {
          const audioRes = await axios.get(window.location.origin + `/uploads/${response.data.filename}?t=${Date.now()}`, { 
            responseType: 'blob',
            timeout: 30000,
            headers: { 
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });
          
          if (audioRes.status === 202) {
            throw new Error("RETRY_NEEDED"); // Special signal for retry
          }

          if (audioRes.data.size === 0) {
            throw new Error("FILE_ZERO_BYTES");
          }
          
          audioBlobData = audioRes.data;
          console.log(`Successfully fetched audio blob on attempt ${blobRetries + 1} (${audioBlobData.size} bytes)`);
          break;
        } catch (e: any) {
          blobRetries++;
          const status = e.response?.status;
          const msg = e.message;
          console.warn(`Blob fetch attempt ${blobRetries} failed: ${msg} (Status: ${status})`);
          
          if (blobRetries >= maxBlobRetries) {
            throw new Error(`Audio downloaded but could not be read back: ${msg} (Status: ${status})`);
          }
          // If status is 202, 404, 500 or just network error, wait and retry
          const waitTime = status === 202 ? 2000 : 1500 * blobRetries;
          await new Promise(r => setTimeout(r, waitTime));
        }
      }
      setAudioBlob(audioBlobData);
      
      setIsLibraryOpen(false);
      setSelectedReciter(null);
      setSurahForAyahSelection(null);
      
      setStep(2);
      
      // Auto-trigger sync if we have verses
      setTimeout(() => {
        syncWithAI();
      }, 1500);
    } catch (error: any) {
      console.error("DEBUG: Full Download Error Object:", error);
      if (error.response) {
        console.error("DEBUG: Backend Response Data:", error.response.data);
        console.error("DEBUG: Backend Response Status:", error.response.status);
      }
      
      const data = error.response?.data;
      const details = data?.details || data?.message || error.message;
      const remoteStatus = data?.remoteStatus;
      const errorCode = data?.code;
      
      console.error("Download Error Details:", { details, remoteStatus, errorCode });

      let finalMsg = details;
      if (remoteStatus || errorCode) {
        finalMsg = settings.language === 'ar' 
          ? `عذراً، فشل تحميل الصوت من المصدر. السبب: ${details} ${errorCode ? `(Code: ${errorCode})` : ''}`
          : `Failed to download audio from source. Reason: ${details} ${errorCode ? `(Code: ${errorCode})` : ''}`;
      } else {
        finalMsg = settings.language === 'ar'
          ? `فشل في الاتصال بالخادم: ${details}`
          : `Connection failure: ${details}`;
      }

      toast.error(settings.language === 'ar' ? "فشل تحميل الملف الصوتي" : "Failed to download remote audio", {
        description: finalMsg,
        duration: 15000,
        action: {
          label: settings.language === 'ar' ? "إعادة المحاولة" : "Retry",
          onClick: () => handleRemoteAudioSelect(url)
        }
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side size check (Recommended 100MB for platform stability)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      const msg = settings.language === 'ar' 
        ? `حجم الملف كبير جداً (${(file.size / (1024 * 1024)).toFixed(1)}MB). الحد الأقصى المستحسن هو 100MB لضمان سرعة الرفع.` 
        : `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Recommended maximum is 100MB for better stability.`;
      toast.warning(settings.language === 'ar' ? "حجم ملف كبير" : "Large file size", { description: msg });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setAudioBlob(file);
    const formData = new FormData();
    formData.append('audio', file);

    let lastUpdate = 0;
    try {
      const res = await axios.post('/api/upload', formData, {
        timeout: 1800000, // 30 minutes
        onUploadProgress: (progressEvent) => {
          const now = Date.now();
          if (now - lastUpdate > 200) { // Throttle updates to every 200ms
            const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 100));
            setUploadProgress(percentCompleted);
            lastUpdate = now;
          }
        }
      });
      setAudioFile(res.data.filename);
      // Auto-init audio settings with URL
      setSettings(s => ({
        ...s,
        audio: {
          url: `/uploads/${res.data.filename}`,
          startTime: 0,
          duration: 0, // 0 = all
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          normalize: false
        }
      }));
    } catch (err: any) {
      console.error("Upload failed details:", {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message
      });
      if (err.response?.status === 413) {
        toast.error(settings.language === 'ar' ? "الملف كبير جداً" : "File too large", {
          description: settings.language === 'ar' 
            ? "حجم الملف كبير جداً بالنسبة للخادم. يرجى تجربة ملف أصغر (أقل من 30 ميجابايت) أو تقليل جودة الملف." 
            : "File is too large for the server. Please try a smaller file (under 30MB) or reduce quality."
        });
      } else {
        const errorMsg = err.response?.data?.error || err.message;
        toast.error(settings.language === 'ar' ? "فشل الرفع" : "Upload failed", {
          description: settings.language === 'ar' 
            ? `فشل الرفع: ${errorMsg}. يرجى التحقق من اتصالك بالإنترنت أو تجربة متصفح آخر.` 
            : `Upload failed: ${errorMsg}. Please check your connection or try another browser.`
        });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const searchVideos = async (query: string) => {
    setIsSearching(true);
    setVideoPage(1);
    try {
      const res = await axios.get('/api/videos/search', { params: { query, page: 1 } });
      if (!res.data || !res.data.videos) {
        setSearchResults([]);
        if (res.data && res.data.error) {
          toast.error(settings.language === 'ar' ? "فشل البحث" : "Search failed", {
            description: res.data.error
          });
        }
        return;
      }
      const mapped = res.data.videos.map((v: any) => ({
        id: v.id,
        url: v.video_files.find((f: any) => f.quality === 'hd')?.link || v.video_files[0].link,
        thumbnail: v.image,
        duration: v.duration
      }));
      setSearchResults(mapped);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const loadMoreVideos = async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    const nextPage = videoPage + 1;
    try {
      const res = await axios.get('/api/videos/search', { 
        params: { 
          query: videoSearchQuery || "nature landscape", 
          page: nextPage 
        } 
      });
      
      if (res.data && res.data.videos) {
        const mapped = res.data.videos.map((v: any) => ({
          id: v.id,
          url: v.video_files.find((f: any) => f.quality === 'hd')?.link || v.video_files[0].link,
          thumbnail: v.image,
          duration: v.duration
        }));
        
        // Filter out clips that are already in the results to prevent duplicate React keys
        const newClips = mapped.filter(newClip => !searchResults.some(existing => existing.id === newClip.id));
        
        setSearchResults([...searchResults, ...newClips]);
        setVideoPage(nextPage);
      }
    } catch (err) {
      console.error("Load more failed", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const addClip = (clip: VideoClip) => {
    setClips([...clips, clip]);
  };

  const updateClipDuration = (idx: number, duration: number) => {
    const next = [...clips];
    next[idx] = { ...next[idx], duration: Math.max(1, duration) };
    setClips(next);
  };

  const plannedClips = useMemo(() => {
    if (clips.length === 0) return [];
    
    // Always add a small buffer (2s) to ensure video is slightly longer than audio
    // This preventing '-shortest' from cutting the video earlier than the audio
    const totalTarget = (settings.audio?.duration || 30) + 2;
    const planned = [...clips];
    let currentTotal = clips.reduce((sum, c) => sum + c.duration, 0);
    
    // Use the clips provided by the user, but repeat them randomly if the audio is longer
    // This creates a continuous background even for long recitations
    while (currentTotal < totalTarget && planned.length < 150) { 
      const randomIndex = Math.floor(Math.random() * clips.length);
      const randomClip = clips[randomIndex];
      planned.push(randomClip);
      currentTotal += randomClip.duration;
    }
    return planned;
  }, [clips, settings.audio?.duration]);

  const activeClipIndex = useMemo(() => {
    let accumulated = 0;
    for (let i = 0; i < plannedClips.length; i++) {
      accumulated += plannedClips[i].duration;
      if (previewTime < accumulated) return i;
    }
    return 0;
  }, [plannedClips, previewTime]);

  const activeVerse = useMemo(() => {
    // time is relative to selection start (0 to duration)
    const time = previewTime;
    if (!verses || verses.length === 0) return undefined;
    
    // 1. Exact match during playback
    if (isPreviewPlaying) {
      const active = verses.find(v => 
        v.startTime !== undefined && 
        v.endTime !== undefined && 
        time >= v.startTime && 
        time <= v.endTime
      );
      
      if (active) return active;

      // Sticky Logic for gaps: show the verse that just ended 
      // if we are within 2 seconds of its end and no other verse is starting.
      const lastEnded = [...verses]
        .reverse()
        .find(v => v.endTime !== undefined && time > v.endTime);
      
      if (lastEnded) {
        const nextStarting = verses.find(v => v.startTime !== undefined && v.startTime > time);
        // Only keep it if the next one isn't about to start (0.3s buffer)
        if (!nextStarting || (nextStarting.startTime - time > 0.3)) {
          if (time - (lastEnded.endTime || 0) < 2.0) {
            return lastEnded;
          }
        }
      }
      
      return undefined;
    }
    
    // 2. If NOT playing (scrubbing/paused), find the most relevant verse
    // We try to find the one the user most likely wants to see
    const atTime = verses.find(v => v.startTime !== undefined && v.endTime !== undefined && time >= v.startTime && time <= v.endTime);
    if (atTime) return atTime;

    const lastPlayed = [...verses]
      .reverse()
      .find(v => v.endTime !== undefined && time >= v.endTime);
    
    if (lastPlayed) return lastPlayed;
    
    // Fallback: Show the first verse so we always have something to see/style
    return verses[0];
  }, [verses, previewTime, isPreviewPlaying]);

  const fetchVerses = async () => {
    try {
      const metaRes = await axios.get(`/api/quran/surah/${surah}`);
      const maxVerses = metaRes.data.data.numberOfAyahs;
      const effectiveEnd = Math.min(versesRange.end, maxVerses);
      
      const res = await axios.get(`/api/quran/surah/${surah}/range`, {
        params: { start: versesRange.start, end: effectiveEnd }
      });
      
      const currentSurah = SURAH_LIST.find(s => s.id === surah);
      const mappedVerses = res.data.data.map((v: any) => ({
        text: v.text,
        translation: v.translation,
        startTime: undefined, 
        endTime: undefined,
        number: v.number,
        surahName: currentSurah?.name,
        ayahNumber: v.number
      }));
      setVerses(mappedVerses);
    } catch (err) {
      console.error("Fetch verses failed", err);
    }
  };

  useEffect(() => {
    if (step === 2) {
      fetchVerses();
    }
  }, [surah, versesRange.start, versesRange.end, step]);

  const detectSurahAndVersesAI = async () => {
    setIsDetectingAI(true);
    try {
      if (!audioFile) {
        toast.error(settings.language === 'ar' ? "يرجى رفع ملف صوتي أولاً" : "Please upload an audio file first");
        return;
      }

      toast.info(settings.language === 'ar' ? "جاري تحليل مقطع الصوت..." : "Analyzing audio clip...", { duration: 4000 });

      // Use server-side processing for efficiency - avoids browser memory issues with large files
      const startTime = settings.audio?.startTime || 0;
      const duration = settings.audio?.duration || 0;
      
      let processedData = null;
      let retries = 0;
      const maxRetries = 150;

      while (retries < maxRetries) {
        const { data, status } = await axios.post("/api/process-audio", {
          audioFile,
          startTime,
          duration
        });

        if (status === 202 || !data || !data.base64) {
          console.log(`Audio still processing, attempt ${retries + 1}...`);
          retries++;
          if (retries >= maxRetries) {
            throw new Error(data?.error || (settings.language === 'ar' ? "فشل تجهيز ملف الصوت" : "Audio processing failed"));
          }
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }
        processedData = data;
        break;
      }

      if (!processedData) throw new Error("Audio processing timeout");

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Act as an expert Quranic scholar. Listen to this audio clip and accurately identify which Surah and exactly which Ayah/Verse numbers it contains.
      
      STRICT INSTRUCTIONS:
      1. Identification: Be extremely precise.
      2. Verses: List the START and END Ayah numbers identified.
      3. Format: Return ONLY valid JSON.
      
      REQUIRED JSON STRUCTURE:
      {"surah_id": 1, "start_verse": 1, "end_verse": 7}`;

      const result = await ai.models.generateContent({
        model: "gemini-flash-latest", 
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: processedData.base64, mimeType: "audio/mpeg" } }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: AIType.OBJECT,
            properties: {
              surah_id: { type: AIType.INTEGER },
              start_verse: { type: AIType.INTEGER },
              end_verse: { type: AIType.INTEGER }
            },
            required: ["surah_id", "start_verse", "end_verse"]
          }
        }
      });

      const data = JSON.parse(result.text);
      if (data.surah_id && data.start_verse && data.end_verse) {
        setSurah(String(data.surah_id));
        setVersesRange({ start: data.start_verse, end: data.end_verse });
        toast.success(settings.language === 'ar' ? "تم التعرف بنجاح" : "Detection successful", {
          description: settings.language === 'ar' 
            ? `سورة رقم ${data.surah_id}، الآيات من رقم ${data.start_verse} إلى ${data.end_verse}` 
            : `Surah #${data.surah_id}, Verses ${data.start_verse} to ${data.end_verse}`
        });
      }
    } catch (error: any) {
      console.error("Failed to detect surah/verses", error);
      toast.error(settings.language === 'ar' ? "فشل التعرف التلقائي" : "Automatic detection failed", {
        description: error.message || (settings.language === 'ar' ? "يرجى التحديد يدوياً." : "Please select manually.")
      });
    } finally {
      setIsDetectingAI(false);
    }
  };

  const syncWithAI = async () => {
    if (!audioFile) return;
    
    // If verses are still loading, wait a bit
    if (verses.length === 0) {
      toast.info(settings.language === 'ar' ? "جاري تحميل بيانات الآيات..." : "Loading verse data...");
      let verseRetries = 0;
      while (verses.length === 0 && verseRetries < 5) {
        await new Promise(r => setTimeout(r, 1000));
        verseRetries++;
      }
      if (verses.length === 0) {
        toast.error(settings.language === 'ar' ? "لا توجد آيات للمزامنة. يرجى اختيار السورة والآيات أولاً." : "No verses to sync. Please select surah and verses first.");
        return;
      }
    }

    setIsSyncing(true);
    
    const startTimeOffset = settings.audio?.startTime || 0;
    let totalDuration = settings.audio?.duration || 0;
    
    // Quick probe if duration is missing
    if (totalDuration <= 0) {
      const audioEl = document.getElementById('preview-audio') as HTMLAudioElement;
      if (audioEl && audioEl.duration > 0 && !isNaN(audioEl.duration)) {
        totalDuration = audioEl.duration;
      }
    }

    toast.info(settings.language === 'ar' ? "بدء المزامنة الذكية..." : "Starting smart synchronization...", {
      description: settings.language === 'ar' 
        ? "جاري تقسيم الملف ومعالجته لضمان الدقة." 
        : "The file will be processed in segments for maximum accuracy.",
      duration: 6000,
    });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let processedData = null;
      let retries = 0;
      const maxRetries = 150; // Allow up to 5 minutes for large surah downloads/merges

      while (retries < maxRetries) {
        const { data, status } = await axios.post("/api/process-audio", {
          audioFile,
          startTime: startTimeOffset,
          duration: totalDuration
        });

        if (status === 202 || !data || !data.base64) {
          retries++;
          
          // Try to get download progress if it's still downloading
          try {
            const progressRes = await axios.get(`/api/download-progress/${audioFile}`);
            if (progressRes.data && progressRes.data.status === "downloading") {
              const msg = settings.language === 'ar' 
                ? `جاري تحميل ملف الصوت... ${progressRes.data.progress}%` 
                : `Downloading audio... ${progressRes.data.progress}%`;
              toast.info(msg, { id: 'audio-download-progress' });
            } else if (progressRes.data && progressRes.data.status === "merging") {
              const msg = settings.language === 'ar' 
                ? "جاري دمج ملفات الآيات..." 
                : "Merging verse files...";
              toast.info(msg, { id: 'audio-download-progress' });
            }
          } catch (e) {
            // Silently fail if progress check fails
          }

          if (retries >= maxRetries) {
            throw new Error(data?.error || (settings.language === 'ar' ? "فشل تجهيز ملف الصوت" : "Audio processing failed"));
          }
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        
        // Success
        toast.dismiss('audio-download-progress');
        processedData = data;
        break;
      }

      if (!processedData) throw new Error("Audio processing timeout");

      // Smaller chunks are much more reliable for precise synchronization
      const CHUNK_SIZE = 15; 
      const updatedVerses = [...verses];
      const verseChunks = [];
      for (let i = 0; i < verses.length; i += CHUNK_SIZE) {
        verseChunks.push(verses.slice(i, i + CHUNK_SIZE));
      }

      const syncPromise = async (currentChunk: any[], chunkIdx: number) => {
        const globalStartIndex = chunkIdx * CHUNK_SIZE;
        
        const systemInstruction = `You are a professional Quranic audio-to-text synchronizer. 
        Your task is to provide high-precision timestamps for a list of verses based on the provided audio.
        Precision is your top priority (milliseconds accuracy). 
        The timestamps MUST be strictly increasing. 
        Important: Look for the specific verses requested anywhere in the audio, but note they appear in the sequence provided.`;

        const prompt = `Carefully listen to the provided Quranic recitation and generate exact timestamps for these specific verses.
        
        Rules:
        1. Accuracy: Find the EXACT start and end of each verse pronunciation.
        2. Format: Return a JSON array of objects.
        3. Indexing: Use the EXACT "global_index" provided in the list below for each verse.
        4. Reference: Timestamps (seconds) must be relative to the beginning of this audio file (0.0).
        5. Sequence: start_time[i] < end_time[i] and end_time[i] <= start_time[i+1].
        
        Requested Verses (Starting at index ${globalStartIndex}):
        ${currentChunk.map((v, i) => `[global_index: ${globalStartIndex + i}]: "${v.text}"`).join('\n')}
        
        Example Output Format:
        [
          {"global_index": ${globalStartIndex}, "start_time": 1.25, "end_time": 4.80},
          {"global_index": ${globalStartIndex + 1}, "start_time": 4.90, "end_time": 10.15}
        ]`;

        const result = await ai.models.generateContent({
          model: "gemini-flash-latest", 
          contents: {
            parts: [
              { text: prompt },
              { inlineData: { data: processedData!.base64, mimeType: "audio/mpeg" } }
            ]
          },
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: AIType.ARRAY,
              items: {
                type: AIType.OBJECT,
                properties: {
                  global_index: { type: AIType.INTEGER },
                  start_time: { type: AIType.NUMBER },
                  end_time: { type: AIType.NUMBER }
                },
                required: ["global_index", "start_time", "end_time"]
              }
            }
          }
        });

        // The text property of GenerateContentResponse is what we want
        const syncText = result.text.trim();
        return JSON.parse(syncText);
      };

      // Sequential processing might be more reliable for later chunks to avoid model overload
      const allResults: any[] = [];
      const batchSize = 1; 
      for (let i = 0; i < verseChunks.length; i += batchSize) {
        try {
          const batch = verseChunks.slice(i, i + batchSize).map((chunk, idx) => syncPromise(chunk, i + idx));
          const batchResults = await Promise.all(batch);
          allResults.push(...batchResults.flat());
          
          const progress = Math.round(((i + batch.length) / verseChunks.length) * 100);
          toast.info(settings.language === 'ar' ? `جاري المزامنة... (${progress}%)` : `Syncing... (${progress}%)`, { id: 'sync-progress' });
          
          // Add a small breather for the API
          if (i + batchSize < verseChunks.length) {
            await new Promise(r => setTimeout(r, 1500));
          }
        } catch (chunkErr: any) {
          console.error(`Chunk starting at ${i} failed:`, chunkErr);
          // If a chunk fails, try one more time or just continue to next to avoid losing EVERYTHING
          toast.warning(settings.language === 'ar' ? `فشل جزء من المزامنة (${i})` : `Partial sync failed (${i})`);
        }
      }

      const syncedIndexes = new Set();
      allResults.forEach((item: any) => {
        if (updatedVerses[item.global_index]) {
          updatedVerses[item.global_index].startTime = Math.floor(Math.max(0, item.start_time) * 100) / 100;
          updatedVerses[item.global_index].endTime = Math.floor(Math.max(0.1, item.end_time) * 100) / 100;
          syncedIndexes.add(item.global_index);
        }
      });

      // Fill missing ones with linear distribution relative to neighbors
      let gapIdx = 0;
      while (gapIdx < updatedVerses.length) {
        if (!syncedIndexes.has(gapIdx)) {
          let gapEnd = gapIdx;
          while (gapEnd < updatedVerses.length && !syncedIndexes.has(gapEnd)) {
            gapEnd++;
          }
          
          const prevTime = gapIdx > 0 ? updatedVerses[gapIdx - 1].endTime! : 0;
          const nextTime = gapEnd < updatedVerses.length ? updatedVerses[gapEnd].startTime! : (totalDuration || prevTime + 5);
          
          const gapCount = gapEnd - gapIdx;
          const verseDuration = (nextTime - prevTime) / gapCount;
          
          for (let k = gapIdx; k < gapEnd; k++) {
            updatedVerses[k].startTime = Math.floor((prevTime + (k - gapIdx) * verseDuration) * 100) / 100;
            updatedVerses[k].endTime = Math.floor((prevTime + (k - gapIdx + 1) * verseDuration) * 100) / 100;
          }
          gapIdx = gapEnd;
        } else {
          gapIdx++;
        }
      }

      // Final refinement: ensure no overlaps if required, or ensure continuous flow
      for (let i = 0; i < updatedVerses.length - 1; i++) {
        if (updatedVerses[i].endTime! > updatedVerses[i+1].startTime!) {
          const midpoint = (updatedVerses[i].endTime! + updatedVerses[i+1].startTime!) / 2;
          updatedVerses[i].endTime = Math.floor(midpoint * 100) / 100;
          updatedVerses[i+1].startTime = Math.floor(midpoint * 100) / 100;
        }
        // Minimal gap check
        if (updatedVerses[i+1].startTime! < updatedVerses[i].endTime!) {
           updatedVerses[i+1].startTime = updatedVerses[i].endTime;
        }
      }

      setVerses(updatedVerses);
      toast.success(settings.language === 'ar' ? "تمت المزامنة بنجاح" : "Synchronization completed");
    } catch (error: any) {
      console.error("AI Sync failed", error);
      toast.error(settings.language === 'ar' ? "فشلت المزامنة الذكية" : "Smart sync failed", {
        description: error.message
      });
      // Final fallback if the whole process crashed
      const duration = totalDuration || 0;
      if (duration > 0 && verses.some(v => v.startTime === undefined)) {
        distributeVersesEvenly(duration);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const distributeVersesEvenly = (duration: number) => {
    const verseDuration = duration / verses.length;
    const fallbackVerses = verses.map((v, i) => ({
      ...v,
      startTime: Math.floor(i * verseDuration * 100) / 100,
      endTime: Math.floor((i + 1) * verseDuration * 100) / 100
    }));
    setVerses(fallbackVerses);
  };

  const generateVideo = async () => {
    // Update page title
    document.title = "Qari Canvas - Quran Video Generator";
    setResultUrl(null);
    setResultId(null);
    
    if (!audioFile) {
      toast.error(settings.language === 'ar' ? "يرجى رفع ملف صوتي أولاً" : "Please upload an audio file first");
      return;
    }

    setIsGenerating(true);
    try {
      // 0. Validate Surah range
      const metaRes = await axios.get(`/api/quran/surah/${surah}`);
      const maxVerses = metaRes.data.data.numberOfAyahs;
      
      if (versesRange.start > maxVerses) {
        throw new Error(settings.language === 'ar' 
          ? `السورة المختارة تحتوي على ${maxVerses} آية فقط. بداية النطاق غير صالحة.` 
          : `Selected Surah has only ${maxVerses} verses. Start range is invalid.`);
      }
      
      const effectiveEnd = Math.min(versesRange.end, maxVerses);
      if (effectiveEnd < versesRange.start) {
        throw new Error(settings.language === 'ar' 
          ? `نطاق الآيات غير صالح.` 
          : `Invalid verse range.`);
      }

      if (verses.length === 0) {
        throw new Error(settings.language === 'ar' ? "لم يتم العثور على أي آيات" : "No verses found");
      }

      // 2. Start generation job
      const res = await axios.post('/api/generate', {
        audioFile,
        videoClips: plannedClips, // Send planned sequence
        verses,
        settings: {
          ...settings,
          language: settings.language
        }
      });
      
      const { jobId } = res.data;
      
      // 3. Poll for status using a safer recursive timeout to prevent 429 errors
      let isPolledFinished = false;
      const poll = async () => {
        if (isPolledFinished) return;
        
        try {
          const statusRes = await axios.get(`/api/generate/status/${jobId}`);
          const { status, progress, url, error } = statusRes.data;
          
          setGenerationProgress(Math.floor(progress));
          setGenerationStatus(status);
          
          if (status === 'completed') {
            isPolledFinished = true;
            setResultUrl(url);
            setResultId(jobId);
            setIsGenerating(false);
            setGenerationProgress(0);
            setGenerationStatus(null);
            nextStep();
            return;
          } else if (status === 'error') {
            isPolledFinished = true;
            setIsGenerating(false);
            setGenerationProgress(0);
            setGenerationStatus(null);
            toast.error(settings.language === 'ar' ? "فشل إنتاج الفيديو" : "Video generation failed", {
              description: error,
              duration: 10000,
            });
            return;
          }
        } catch (pollErr: any) {
          if (pollErr.response?.status === 429) {
            setTimeout(poll, 25000); // 25s backoff for rate limits
            return;
          }
          console.error("Polling error:", pollErr);
        }
        
        setTimeout(poll, 12000); // Default poll: 12 seconds
      };

      // Start polling after 12 seconds
      setTimeout(poll, 12000);

    } catch (err: any) {
      console.error("Generation failed", err);
      const msg = err.response?.data?.error || err.message;
      toast.error(settings.language === 'ar' ? "فشل إنتاج الفيديو" : "Video generation failed", {
        description: msg,
        duration: 10000,
      });
      setIsGenerating(false);
    }
  };

  return (
    <div className={cn(
      "min-h-screen transition-all duration-500 flex flex-col items-stretch p-4 md:p-8",
      settings.theme === 'dark' ? "text-zinc-100" : "text-zinc-900"
    )} dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
      <Toaster position="top-center" expand={true} richColors />
      
      {/* Surah Explorer Overlay */}
      {isSurahExplorerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-500">
          <Card className="w-full max-w-4xl glass-panel border-immersive-gold/10 shadow-[0_0_100px_rgba(212,175,55,0.1)] overflow-hidden flex flex-col max-h-[85vh] relative">
            <Button 
              size="icon" 
              variant="ghost" 
              className="absolute top-4 right-4 z-20 text-white/50 hover:text-white"
              onClick={() => setIsSurahExplorerOpen(false)}
            >
              <Trash2 size={24} />
            </Button>

            <div className="p-8 pb-4">
              <h2 className="text-3xl font-bold text-immersive-gold mb-2 gold-glow">
                {settings.language === 'ar' ? 'فهرس القرآن الكريم' : 'Quran Index'}
              </h2>
              <p className="text-zinc-500 mb-6">
                {settings.language === 'ar' 
                  ? 'تصفح معلومات السور وعدد آياتها ومكان النزول' 
                  : 'Browse surah information, verse counts, and revelation places'}
              </p>

                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                  <Input 
                    placeholder={settings.language === 'ar' ? 'ابحث عن سورة...' : 'Search surahs...'}
                    className="pl-12 bg-white/5 border-zinc-800 h-12 text-lg focus:ring-immersive-gold/20"
                    onChange={(e) => setSurahSearch(e.target.value)}
                    value={surahSearch ?? ""}
                  />
                </div>
            </div>

            <div className="flex-grow overflow-y-auto px-8 pb-8 custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {SURAH_LIST
                  .filter(s => s.name.includes(surahSearch) || s.enName.toLowerCase().includes(surahSearch.toLowerCase()) || s.id.toString().includes(surahSearch))
                  .map((s) => (
                    <Card 
                      key={s.id} 
                      className="p-4 glass-panel border-zinc-800 hover:border-immersive-gold/30 transition-all cursor-pointer group"
                      onClick={() => {
                        setSurah(s.id.toString());
                        setIsSurahExplorerOpen(false);
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="w-8 h-8 rounded-lg bg-immersive-gold/10 flex items-center justify-center text-immersive-gold text-xs font-bold border border-immersive-gold/20">
                          {s.id}
                        </div>
                        <span className="font-arabic text-xl font-bold group-hover:text-immersive-gold transition-colors">{s.name}</span>
                      </div>
                      <div className="mt-4 flex justify-between text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                        <span>{s.enName}</span>
                      </div>
                    </Card>
                  ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Library Modal */}
      {isLibraryOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
          <Card className="w-full max-w-4xl glass-panel border-immersive-gold/20 shadow-[0_0_100px_rgba(212,175,55,0.1)] overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-immersive-gold/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-immersive-gold/20 rounded-xl flex items-center justify-center text-immersive-gold">
                  <Music2 size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-immersive-gold gold-glow">
                    {settings.language === 'ar' ? 'المكتبة الصوتية الرقمية' : 'Digital Audio Library'}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    {settings.language === 'ar' ? 'تلاوات قرآنية مجزأة لكل آية من EveryAyah' : 'Ayah-by-ayah recitations from EveryAyah'}
                  </p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {
                  setIsLibraryOpen(false);
                  setSelectedReciter(null);
                  setSurahForAyahSelection(null);
                }}
                className="text-zinc-500 hover:text-white"
              >
                <X size={24} />
              </Button>
            </div>

            <div className="flex-grow overflow-y-auto p-6 custom-scrollbar bg-black/40">
              {!selectedReciter ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {RECITERS_LIST.map((r, idx) => (
                    <Button
                      key={idx}
                      variant="ghost"
                      className="h-auto py-6 px-5 justify-start text-right glass-panel border-white/5 hover:border-immersive-gold/40 hover:bg-immersive-gold/10 group flex flex-col items-start gap-1"
                      onClick={() => setSelectedReciter(r)}
                    >
                      <span className="font-arabic text-xl font-bold group-hover:text-immersive-gold transition-colors">{r.name}</span>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest opacity-60">EveryAyah Server</span>
                    </Button>
                  ))}
                </div>
              ) : !surahForAyahSelection ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-5 bg-immersive-gold/10 rounded-2xl border border-immersive-gold/20">
                    <div className="w-12 h-12 bg-immersive-gold/20 rounded-full flex items-center justify-center text-immersive-gold">
                      <Sparkles size={24} />
                    </div>
                    <div className="flex-grow">
                      <span className="text-[10px] text-immersive-gold font-bold uppercase tracking-widest">{settings.language === 'ar' ? 'القارئ المختار' : 'Selected Reciter'}</span>
                      <p className="font-bold text-xl">{selectedReciter.name}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelectedReciter(null)} className="border-zinc-700 h-10 px-4">
                      {settings.language === 'ar' ? 'تغيير القارئ' : 'Change Reciter'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {SURAH_LIST.map(s => (
                      <Button
                        key={s.id}
                        variant="ghost"
                        className="h-auto py-4 px-2 flex flex-col gap-1 glass-panel border-white/5 hover:border-immersive-gold/40 hover:bg-immersive-gold/5"
                        onClick={() => {
                          setSurahForAyahSelection(s);
                          setAyahRange({ start: 1, end: Math.min(7, s.verses) });
                        }}
                      >
                        <span className="text-[10px] text-zinc-600 font-bold">{s.id}</span>
                        <span className="font-arabic font-bold text-sm truncate">{s.name}</span>
                        <span className="text-[8px] text-zinc-500">{s.verses} {settings.language === 'ar' ? 'آية' : 'Ayahs'}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-md mx-auto py-12">
                  <div className="bg-immersive-gold/5 border border-immersive-gold/20 rounded-3xl p-10 space-y-8 shadow-[0_0_50px_rgba(212,175,55,0.05)]">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-immersive-gold/20 rounded-2xl flex items-center justify-center text-immersive-gold mx-auto mb-4">
                        <BookOpen size={32} />
                      </div>
                      <h3 className="text-3xl font-bold mb-2">
                        {settings.language === 'ar' ? 'تحديد الآيات' : 'Select Verses'}
                      </h3>
                      <p className="text-zinc-500">
                        {settings.language === 'ar' 
                          ? `سورة ${surahForAyahSelection.name} (${surahForAyahSelection.verses} آية)`
                          : `Surah ${surahForAyahSelection.enName} (${surahForAyahSelection.verses} Verses)`}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-[12px] font-bold text-zinc-500 uppercase tracking-wider">{settings.language === 'ar' ? 'من آية' : 'From'}</label>
                        <Input 
                          type="number" 
                          min={1} 
                          max={surahForAyahSelection?.verses || 286} 
                          value={ayahRange.start}
                          onChange={e => {
                            if (!surahForAyahSelection) return;
                            const val = Math.max(1, Math.min(surahForAyahSelection.verses, parseInt(e.target.value) || 1));
                            setAyahRange(p => ({ ...p, start: val, end: Math.max(val, p.end) }));
                          }}
                          className="bg-black/50 border-zinc-700 h-12 text-center text-lg"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[12px] font-bold text-zinc-500 uppercase tracking-wider">{settings.language === 'ar' ? 'إلى آية' : 'To'}</label>
                        <Input 
                          type="number" 
                          min={ayahRange.start} 
                          max={surahForAyahSelection?.verses || 286} 
                          value={ayahRange.end}
                          onChange={e => {
                            if (!surahForAyahSelection) return;
                            const val = Math.max(ayahRange.start, Math.min(surahForAyahSelection.verses, parseInt(e.target.value) || ayahRange.start));
                            setAyahRange(p => ({ ...p, end: val }));
                          }}
                          className="bg-black/50 border-zinc-700 h-12 text-center text-lg"
                        />
                      </div>
                    </div>

                    <div className="pt-6 flex gap-4">
                      <Button 
                        variant="outline" 
                        disabled={isUploading}
                        className="flex-1 border-zinc-700 h-14 rounded-xl text-lg" 
                        onClick={() => setSurahForAyahSelection(null)}
                      >
                        {settings.language === 'ar' ? 'رجوع' : 'Back'}
                      </Button>
                      <Button 
                        disabled={isUploading}
                        className="flex-1 bg-immersive-gold text-black font-black hover:bg-immersive-gold/90 h-14 rounded-xl text-lg shadow-xl relative overflow-hidden group" 
                        onClick={() => {
                          const baseUrl = `https://www.everyayah.com/data/${selectedReciter.dir}/`;
                          handleRemoteAudioSelect(baseUrl, surahForAyahSelection.id, ayahRange);
                        }}
                      >
                        {isUploading ? (
                          <div className="flex items-center justify-center gap-3">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                              <RefreshCw size={24} />
                            </motion.div>
                            <span>{uploadProgress}%</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                             <Download size={24} className="group-hover:translate-y-0.5 transition-transform" />
                             <span>{settings.language === 'ar' ? 'بدء الجلب' : 'Start Fetch'}</span>
                          </div>
                        )}
                        {isUploading && (
                          <motion.div 
                            className="absolute bottom-0 left-0 h-1 bg-black/30"
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                          />
                        )}
                      </Button>
                    </div>
                    
                    <p className="text-[11px] text-zinc-600 text-center italic">
                      {settings.language === 'ar'
                        ? '* سيتم دمج جميع الآيات المطلوبة تلقائياً في ملف صوتي واحد'
                        : '* All requested ayahs will be automatically merged into one file'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Navbar */}
      <nav className="w-full flex justify-between items-center mb-12 glass-panel p-6 rounded-2xl shadow-2xl border-white/5">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center">
            <div className="relative group">
              <div className="w-12 h-12 bg-immersive-gold rounded-xl flex items-center justify-center text-immersive-bg shadow-lg gold-glow relative z-10 transition-transform active:scale-95 overflow-hidden">
                <BookOpen size={24} fill="currentColor" />
                <motion.div 
                  animate={{ 
                    opacity: [0, 1, 0, 0.8, 0],
                    scale: [0.8, 1.2, 0.8, 1, 0.8],
                    rotate: [0, 45, -45, 90, 0]
                  }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <Sparkles size={16} className="text-white/40" />
                </motion.div>
              </div>
              {/* Pulsing glow background for the " يتلألئ" effect */}
              <div className="absolute inset-0 bg-immersive-gold/40 rounded-xl blur-lg animate-pulse -z-0" />
            </div>
            <span className="text-[8px] mt-1.5 font-bold text-immersive-gold italic opacity-80 whitespace-nowrap">
              {settings.language === 'ar' ? 'لا تنسونا بصالح دعائكم' : 'Remember us in your prayers'}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-immersive-gold gold-glow leading-tight">
            {settings.language === 'ar' ? 'الذهبى' : 'The Golden'}
            <span className="block text-xs md:text-sm font-medium text-zinc-400 mt-0.5 uppercase tracking-[0.2em]">
              {settings.language === 'ar' ? 'مصمم فيديوهات القرأن الكريم الذكى' : 'Smart Quran Video Designer'}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {appConfig?.socials?.map((social) => (
            <Button
              key={social.name}
              size="icon"
              variant="ghost"
              className="text-zinc-500 hover:text-white transition-all hover:scale-110"
              style={{ '--hover-color': social.color } as any}
              onClick={() => window.open(social.url, '_blank')}
            >
              <IconComponent name={social.icon} size={20} />
            </Button>
          ))}
          <div className="w-px h-6 bg-zinc-800 mx-2" />
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {settings.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={toggleLanguage}>
            <Globe size={18} />
            {settings.language === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>
      </nav>

      <main className="w-full flex-grow flex flex-col">
        {/* Progress Indicator */}
        <div className="flex justify-between mb-12 px-2 md:px-24 relative">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-zinc-800 -translate-y-1/2 z-0" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={cn(
              "z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300",
              step > i ? "bg-immersive-gold border-immersive-gold text-immersive-bg" : 
              step === i ? "glass-panel border-immersive-gold text-immersive-gold scale-110 gold-glow ring-4 ring-immersive-gold/20" : 
              "glass-panel border-zinc-700 text-zinc-500"
            )}>
              {step > i ? <CheckCircle2 size={24} /> : i}
            </div>
          ))}
        </div>

        <div className="flex-grow">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center text-center max-w-4xl mx-auto py-12"
              >
                {!audioFile && !isUploading ? (
                  <>
                    <div className="w-24 h-24 glass-panel rounded-3xl flex items-center justify-center mb-8 border border-zinc-800 shadow-2xl">
                      <Upload className="text-immersive-gold gold-glow" size={40} />
                    </div>
                    <h2 className="text-4xl font-bold mb-4 font-arabic text-immersive-gold">
                      {settings.language === 'ar' ? 'ارفع صوت التلاوة' : 'Upload Recitation Audio'}
                    </h2>
                    <p className="text-zinc-400 mb-8 text-lg">
                      {settings.language === 'ar' ? 'ابدأ باختيار ملف MP3 للتلاوة التي تريد تحويلها لفيديو' : 'Choose an MP3 file of the recitation you want to visualize.'}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center w-full">
                      <label className="group relative cursor-pointer overflow-hidden rounded-2xl bg-immersive-gold px-8 py-4 text-immersive-bg shadow-xl transition-all hover:bg-immersive-gold/90 hover:scale-105 active:scale-95 flex-1 max-w-[240px]">
                        <span className="flex items-center justify-center gap-3 font-bold">
                          <Plus size={20} />
                          {settings.language === 'ar' ? 'رفع ملف صوتي' : 'Upload Audio'}
                        </span>
                        <input type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
                      </label>
                      
                      <Button 
                        onClick={() => setIsLibraryOpen(true)}
                        className="group relative overflow-hidden rounded-2xl border-2 border-immersive-gold bg-transparent px-8 py-4 text-immersive-gold shadow-xl transition-all hover:bg-immersive-gold/10 hover:scale-105 active:scale-95 flex-1 max-w-[240px]"
                      >
                        <span className="flex items-center justify-center gap-3 font-bold">
                          <Music2 size={20} />
                          {settings.language === 'ar' ? 'مكتبة القراء' : 'Reciters Library'}
                        </span>
                      </Button>
                    </div>

                    <Button 
                      onClick={() => setIsSurahExplorerOpen(true)}
                      variant="ghost" 
                      className="mt-6 text-zinc-500 hover:text-immersive-gold transition-colors gap-2"
                    >
                      <Globe size={18} />
                      {settings.language === 'ar' ? 'تصفح السور والآيات' : 'Browse Suwar & Ayaat'}
                    </Button>
                  </>
                ) : isUploading ? (
                  <div className="w-full max-w-md">
                    <div className="relative w-32 h-32 mx-auto mb-8">
                      <svg className="w-full h-full" viewBox="0 0 100 100">
                        <circle className="text-zinc-800 stroke-current" strokeWidth="8" cx="50" cy="50" r="40" fill="transparent"></circle>
                        <circle className="text-immersive-gold stroke-current" strokeWidth="8" strokeDasharray="251.2" strokeDashoffset={251.2 - (251.2 * uploadProgress) / 100} strokeLinecap="round" cx="50" cy="50" r="40" fill="transparent"></circle>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-immersive-gold">
                        {uploadProgress}%
                      </div>
                    </div>
                    <p className="text-xl font-medium text-zinc-300">
                      {settings.language === 'ar' 
                        ? (uploadProgress < 10 ? 'بدء التحميل...' : uploadProgress > 90 ? 'جاري الدمج والمعالجة...' : `جاري التحميل... ${uploadProgress}%`) 
                        : (uploadProgress < 10 ? 'Starting download...' : uploadProgress > 90 ? 'Merging and processing...' : `Downloading... ${uploadProgress}%`)}
                    </p>
                  </div>
                ) : (
                  <div className="w-full space-y-8">
                    <div className="flex items-center justify-between p-6 glass-panel rounded-2xl border border-immersive-gold/20">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-immersive-gold/10 rounded-xl flex items-center justify-center text-immersive-gold">
                          <CheckCircle2 size={24} />
                        </div>
                        <div className="text-left rtl:text-right">
                          <p className="text-zinc-400 text-sm">{settings.language === 'ar' ? 'تم رفع الملف بنجاح' : 'Audio file uploaded'}</p>
                          <p className="font-bold text-lg">{audioFile}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setAudioFile('')} className="text-zinc-500 hover:text-red-400">
                        <RotateCcw size={20} />
                      </Button>
                    </div>

                    <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl flex items-center gap-3 w-full max-w-lg">
                        <CheckCircle2 size={20} />
                        <span className="font-bold">{settings.language === 'ar' ? 'تم الرفع! قم بضبط مدة الصوت والخيارات أدناه' : 'Uploaded! Configure audio duration and options below'}</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left rtl:text-right w-full">
                        {/* Simplified Trimming Card */}
                        <Card className="p-6 glass-panel border-zinc-800 space-y-4 hover:border-immersive-gold/30 transition-colors">
                          <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <h3 className="font-bold text-immersive-gold flex items-center gap-2">
                              <Scissors size={18} />
                              {settings.language === 'ar' ? 'اقتصاص المقطع' : 'Clip Trimming'}
                            </h3>
                          </div>
                          <div className="space-y-4">
                            {/* Start Time MM:SS */}
                            <div className="space-y-2">
                              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block">
                                {settings.language === 'ar' ? 'نقطة البداية' : 'Start Offset'} (MM:SS)
                              </label>
                              <div className="flex gap-2 items-center">
                                <div className="flex-1 relative">
                                  <Input 
                                    type="number" 
                                    placeholder="MM"
                                    value={Math.floor((settings.audio?.startTime || 0) / 60)} 
                                    onChange={(e) => {
                                      const m = Math.max(0, Number(e.target.value));
                                      const s = (settings.audio?.startTime || 0) % 60;
                                      setSettings(prev => ({ ...prev, audio: { ...(prev.audio || { duration: 0 }), startTime: m * 60 + s }}));
                                    }}
                                    className="bg-black/30 border-zinc-800 h-10 text-center"
                                  />
                                </div>
                                <span className="text-immersive-gold">:</span>
                                <div className="flex-1 relative">
                                  <Input 
                                    type="number" 
                                    placeholder="SS"
                                    value={Math.floor(((settings.audio?.startTime || 0) % 60) * 100) / 100} 
                                    onChange={(e) => {
                                      const s = Math.min(59.99, Math.max(0, parseFloat(e.target.value) || 0));
                                      const m = Math.floor((settings.audio?.startTime || 0) / 60);
                                      setSettings(prev => ({ ...prev, audio: { ...(prev.audio || { duration: 0 }), startTime: Math.floor((m * 60 + s) * 100) / 100 }}));
                                    }}
                                    className="bg-black/30 border-zinc-800 h-10 text-center"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* End Time MM:SS */}
                            <div className="space-y-2">
                              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block">
                                {settings.language === 'ar' ? 'نقطة النهاية' : 'End Time'} (MM:SS)
                              </label>
                              <div className="flex gap-2 items-center">
                                <div className="flex-1 relative">
                                  <Input 
                                    type="number" 
                                    placeholder="MM"
                                    value={Math.floor(((settings.audio?.startTime || 0) + (settings.audio?.duration || 0)) / 60)} 
                                    onChange={(e) => {
                                      const m = Math.max(0, Number(e.target.value));
                                      const currentEnd = (settings.audio?.startTime || 0) + (settings.audio?.duration || 0);
                                      const s = currentEnd % 60;
                                      const newEnd = m * 60 + s;
                                      const newDuration = Math.max(0, newEnd - (settings.audio?.startTime || 0));
                                      setSettings(prev => ({ ...prev, audio: { ...(prev.audio || { startTime: 0 }), duration: newDuration }}));
                                    }}
                                    className="bg-black/30 border-zinc-800 h-10 text-center"
                                  />
                                </div>
                                <span className="text-immersive-gold">:</span>
                                <div className="flex-1 relative">
                                  <Input 
                                    type="number" 
                                    placeholder="SS"
                                    value={Math.floor((((settings.audio?.startTime || 0) + (settings.audio?.duration || 0)) % 60) * 100) / 100} 
                                    onChange={(e) => {
                                      const s = Math.min(59.99, Math.max(0, parseFloat(e.target.value) || 0));
                                      const currentEnd = (settings.audio?.startTime || 0) + (settings.audio?.duration || 0);
                                      const m = Math.floor(currentEnd / 60);
                                      const newEnd = m * 60 + s;
                                      const newDuration = Math.max(0, newEnd - (settings.audio?.startTime || 0));
                                      setSettings(prev => ({ ...prev, audio: { ...(prev.audio || { startTime: 0 }), duration: Math.floor(newDuration * 100) / 100 }}));
                                    }}
                                    className="bg-black/30 border-zinc-800 h-10 text-center"
                                  />
                                </div>
                              </div>
                            </div>

                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!audioFile}
                              onClick={() => {
                                if (!trimmingAudioRef.current) return;
                                if (isTrimmingPreviewPlaying) {
                                  trimmingAudioRef.current.pause();
                                } else {
                                  trimmingAudioRef.current.currentTime = settings.audio?.startTime || 0;
                                  trimmingAudioRef.current.play().catch(e => console.error("Preview play failed", e));
                                }
                              }}
                              className={cn(
                                "w-full h-10 gap-2 border-immersive-gold/20 text-immersive-gold hover:bg-immersive-gold/10",
                                isTrimmingPreviewPlaying && "bg-immersive-gold/20 border-immersive-gold/50"
                              )}
                            >
                              {isTrimmingPreviewPlaying ? <Pause size={16} /> : <Play size={16} />}
                              {isTrimmingPreviewPlaying 
                                ? (settings.language === 'ar' ? 'إيقاف المعاينة' : 'Stop Preview')
                                : (settings.language === 'ar' ? 'معاينة الجزء المختار' : 'Preview Selection')
                              }
                            </Button>

                            <audio 
                              ref={trimmingAudioRef}
                              src={audioFile ? `/uploads/${audioFile}` : undefined}
                              className="hidden"
                              onPlay={() => setIsTrimmingPreviewPlaying(true)}
                              onPause={() => setIsTrimmingPreviewPlaying(false)}
                              onEnded={() => setIsTrimmingPreviewPlaying(false)}
                              onTimeUpdate={(e) => {
                                const el = e.currentTarget;
                                const start = settings.audio?.startTime || 0;
                                const duration = settings.audio?.duration || 0;
                                if (duration > 0 && el.currentTime >= (start + duration)) {
                                  el.pause();
                                  el.currentTime = start;
                                  setIsTrimmingPreviewPlaying(false);
                                }
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-zinc-500 italic">
                            {settings.language === 'ar' ? '* اترك الحقول فارغة لاستخدام الملف كاملاً' : '* Leave duration empty for full file'}
                          </p>
                        </Card>

                        {/* Enhanced Audio Improvements Card */}
                        <Card className="p-6 glass-panel border-zinc-800 space-y-4 hover:border-immersive-gold/30 transition-colors">
                          <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <h3 className="font-bold text-immersive-gold flex items-center gap-2">
                              <Volume2 size={18} />
                              {settings.language === 'ar' ? 'جودة وتحسين الصوت' : 'Audio Enhancements'}
                            </h3>
                            <div className="bg-immersive-gold/10 text-immersive-gold px-2 py-0.5 rounded text-[10px] font-bold">
                              {Math.round((settings.audio?.volume || 1) * 100)}%
                            </div>
                          </div>
                          <div className="space-y-5">
                            <div className="px-1">
                              <Slider 
                                value={[settings.audio?.volume || 1]} 
                                min={0} max={2} step={0.1}
                                onValueChange={(val: number[]) => setSettings(s => ({ ...s, audio: { ...s.audio!, volume: val[0] }}))}
                                className="my-2"
                              />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-white/5">
                                <span className="text-[11px] font-medium text-zinc-400">
                                  {settings.language === 'ar' ? 'تطبيع تلقائي' : 'Auto Normalize'}
                                </span>
                                <input 
                                  type="checkbox" 
                                  checked={settings.audio?.normalize}
                                  onChange={(e) => setSettings(s => ({ ...s, audio: { ...s.audio!, normalize: e.target.checked }}))}
                                  className="w-4 h-4 accent-immersive-gold cursor-pointer"
                                />
                              </div>
                              <div className="flex gap-2">
                                <div className="flex-1">
                                  <Input 
                                    type="number" 
                                    placeholder="Fade In"
                                    value={settings.audio?.fadeIn || ''} 
                                    onChange={(e) => setSettings(s => ({ ...s, audio: { ...s.audio!, fadeIn: Math.max(0, Number(e.target.value)) }}))}
                                    className="bg-black/30 border-zinc-800 h-9 text-[11px] placeholder:text-[10px]"
                                  />
                                </div>
                                <div className="flex-1">
                                  <Input 
                                    type="number" 
                                    placeholder="Fade Out"
                                    value={settings.audio?.fadeOut || ''}
                                    onChange={(e) => setSettings(s => ({ ...s, audio: { ...s.audio!, fadeOut: Math.max(0, Number(e.target.value)) }}))}
                                    className="bg-black/30 border-zinc-800 h-9 text-[11px] placeholder:text-[10px]"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </div>

                      <div className="flex flex-col items-center gap-6 w-full max-w-lg bg-black/40 p-6 rounded-3xl border border-zinc-800 shadow-2xl">
                        <audio controls src={`/uploads/${audioFile}`} className="w-full" />
                        <Button 
                          onClick={nextStep} 
                          className="w-full h-16 bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 font-black text-xl rounded-2xl gold-glow flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(234,179,8,0.3)] hover:scale-[1.02] active:scale-95 transition-all"
                        >
                          {settings.language === 'ar' ? 'تأكيد الإعدادات والمتابعة' : 'Confirm Settings & Continue'}
                          <ChevronRight size={24} />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-8 py-4"
              >
                <div className="space-y-6">
                  <Card className="p-6 glass-panel border-zinc-800">
                    <h3 className="text-xl font-bold mb-6 flex items-center justify-between gap-2 text-immersive-gold">
                      <div className="flex items-center gap-2">
                        <Search className="text-immersive-gold" size={20} />
                        {settings.language === 'ar' ? 'تحديد السورة والآيات' : 'Select Surah & Verses'}
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={detectSurahAndVersesAI}
                        disabled={isDetectingAI || !audioFile}
                        className="h-8 gap-2 bg-immersive-gold/5 border-immersive-gold/20 text-immersive-gold hover:bg-immersive-gold/20"
                      >
                        {isDetectingAI ? (
                          <div className="w-3 h-3 border-2 border-immersive-gold/30 border-t-immersive-gold rounded-full animate-spin" />
                        ) : (
                          <Sparkles size={14} />
                        )}
                        {settings.language === 'ar' ? 'تعرف تلقائي (AI)' : 'Auto Detect (AI)'}
                      </Button>
                    </h3>
                    <div className="space-y-6">
                      <div>
                        <label className="text-sm font-medium text-zinc-400 block mb-2 font-arabic uppercase tracking-wider">
                          {settings.language === 'ar' ? 'السورة' : 'Surah'}
                        </label>
                        <div className="space-y-4">
                          <Input 
                            placeholder={settings.language === 'ar' ? 'ابحث عن سورة...' : 'Search surah...'}
                            value={surahSearch}
                            onChange={(e) => setSurahSearch(e.target.value)}
                            className="bg-black/20 border-zinc-800"
                          />
                          <Select value={surah} onValueChange={setSurah}>
                            <SelectTrigger className="bg-black/50 border-zinc-800">
                              <SelectValue>
                                {SURAH_LIST.find(s => s.id === surah)?.name || (settings.language === 'ar' ? 'اختر السورة' : 'Select Surah')}
                                {surah && ` (${surah})`}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="bg-immersive-bg border-zinc-800 max-h-[300px]">
                              {SURAH_LIST.filter(s => 
                                s.name.includes(surahSearch) || 
                                s.enName.toLowerCase().includes(surahSearch.toLowerCase()) ||
                                s.id === surahSearch
                              ).map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {settings.language === 'ar' ? s.name : s.enName} ({s.id})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-zinc-400 block mb-2">
                            {settings.language === 'ar' ? 'من الآية' : 'Start Verse'}
                          </label>
                          <Input 
                            type="number" 
                            value={isNaN(versesRange.start) ? "" : versesRange.start} 
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setVersesRange({...versesRange, start: isNaN(val) ? NaN : val});
                            }}
                            className="bg-black/50 border-zinc-800"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-zinc-400 block mb-2">
                            {settings.language === 'ar' ? 'إلى الآية' : 'End Verse'}
                          </label>
                          <Input 
                            type="number" 
                            value={isNaN(versesRange.end) ? "" : versesRange.end} 
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setVersesRange({...versesRange, end: isNaN(val) ? NaN : val});
                            }}
                            className="bg-black/50 border-zinc-800"
                          />
                        </div>
                      </div>

                      {audioFile && (
                        <div className="pt-4 border-t border-white/5">
                          <Button 
                            onClick={syncWithAI} 
                            disabled={isSyncing || verses.length === 0}
                            className={cn(
                              "w-full h-12 gap-3 font-bold transition-all relative overflow-hidden group",
                              isSyncing 
                                ? "bg-zinc-800 cursor-not-allowed" 
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-900/20"
                            )}
                          >
                            {isSyncing ? (
                              <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {settings.language === 'ar' ? 'جاري المزامنة بالذكاء الاصطناعي...' : 'Syncing with AI...'}
                              </>
                            ) : (
                              <>
                                <Sparkles size={18} className="text-blue-200 animate-pulse" />
                                {settings.language === 'ar' ? 'مزامنة النص مع الصوت (AI)' : 'Sync Text with Audio (AI)'}
                                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 skew-x-12" />
                              </>
                            )}
                          </Button>
                          <p className="text-[10px] text-zinc-500 mt-2 text-center rtl:text-right">
                            {settings.language === 'ar' 
                              ? '* تستخدم هذه الخاصية الذكاء الاصطناعي لتحديد توقيت كل آية تلقائياً بناءً على تلاوة القارئ.' 
                              : '* This feature uses AI to automatically detect when each verse starts based on the audio recording.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
                
                <div className="space-y-6">
                  <div className="p-6 rounded-2xl glass-panel relative overflow-hidden group border border-zinc-800/50">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Zap size={64} className="text-immersive-gold" />
                    </div>
                    <h4 className="font-semibold mb-4 text-immersive-gold text-xs uppercase tracking-[0.2em] flex items-center gap-2">
                       <Play size={12} fill="currentColor" />
                      {settings.language === 'ar' ? 'معاينة الآيات والتوقيت' : 'Verses & Timing Preview'}
                    </h4>
                    
                    <ScrollArea className="h-[300px] pr-4">
                      <div className="space-y-3">
                        {verses.length > 0 ? (
                          verses.map((v, i) => (
                            <div key={i} className="p-3 rounded-xl bg-black/30 border border-white/5 group hover:border-immersive-gold/30 transition-all">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-bold text-zinc-500 px-2 py-0.5 rounded bg-zinc-800/50 border border-zinc-700/50">
                                  {settings.language === 'ar' ? `الآية ${v.number}` : `Verse ${v.number}`}
                                </span>
                                {v.startTime !== undefined && (
                                  <div className="flex gap-2">
                                    <span className="text-[10px] font-mono text-immersive-gold px-2 py-0.5 rounded bg-immersive-gold/10">
                                      {Math.floor(v.startTime / 60)}:{Math.floor(v.startTime % 60).toString().padStart(2, '0')}
                                    </span>
                                    <span className="text-[10px] text-zinc-600">→</span>
                                    <span className="text-[10px] font-mono text-immersive-gold px-2 py-0.5 rounded bg-immersive-gold/10">
                                      {Math.floor(v.endTime / 60)}:{Math.floor(v.endTime % 60).toString().padStart(2, '0')}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <p className="text-xl text-white font-quran text-right leading-relaxed mb-1">
                                {v.text}
                              </p>
                              {v.translation && (
                                <p className="text-[10px] text-zinc-500 italic">
                                  {v.translation}
                                </p>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="flex flex-col items-center justify-center h-[200px] text-zinc-600 gap-2">
                            <Search size={32} strokeWidth={1} />
                            <p className="text-xs uppercase tracking-widest">{settings.language === 'ar' ? 'اختر السورة لعرض الآيات' : 'Select surah to see verses'}</p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-zinc-800/30">
                    <Button variant="ghost" onClick={prevStep} className="text-zinc-400 hover:text-white hover:bg-white/5">
                      {settings.language === 'ar' ? 'السابق' : 'Previous'}
                    </Button>
                    <Button 
                      onClick={nextStep} 
                      disabled={verses.length === 0}
                      className="bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 px-8 font-black rounded-xl gold-glow flex items-center gap-2 group transition-transform active:scale-95"
                    >
                      {settings.language === 'ar' ? 'متابعة لاختيار المشاهد' : 'Continue to Scenes'}
                      <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <Input 
                      placeholder={settings.language === 'ar' ? 'ابحث عن طبيعة، جبال، أنهار...' : 'Search nature, mountains, rivers...'} 
                      className="bg-black/50 border-zinc-800 h-12"
                      value={videoSearchQuery}
                      onChange={(e) => setVideoSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchVideos(videoSearchQuery)}
                    />
                    <Button 
                      onClick={() => searchVideos(videoSearchQuery || "nature landscape")} 
                      className="bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 px-8 font-extrabold shadow-lg active:scale-95 transition-transform"
                    >
                      {settings.language === 'ar' ? 'بحث' : 'Search'}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { ar: 'مناظر طبيعية', en: 'Nature', query: 'nature landscape' },
                      { ar: 'غيوم وسماء', en: 'Sky', query: 'clouds and sky' },
                      { ar: 'جبال', en: 'Mountains', query: 'mountains' },
                      { ar: 'بحر وأمواج', en: 'Ocean', query: 'ocean waves' },
                      { ar: 'نباتات', en: 'Plants', query: 'green plants' },
                      { ar: 'مجرات', en: 'Galaxy', query: 'galaxy space' },
                      { ar: 'مكة', en: 'Makkah', query: 'makkah' }
                    ].map((preset) => (
                      <Button
                        key={preset.query}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setVideoSearchQuery(preset.query);
                          searchVideos(preset.query);
                        }}
                        className="h-7 text-[10px] border-zinc-800 hover:bg-immersive-gold/10 hover:text-immersive-gold hover:border-immersive-gold/30 rounded-full px-4"
                      >
                         {settings.language === 'ar' ? preset.ar : preset.en}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <Card className="lg:col-span-2 p-4 glass-panel">
                    <ScrollArea className="h-[500px] w-full pr-4">
                      {isSearching ? (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                          {[1,2,3,4,5,6].map(i => (
                            <div key={i} className="aspect-video bg-white/5 animate-pulse rounded-lg" />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {searchResults.map(clip => (
                              <div 
                                key={clip.id} 
                                className="group relative aspect-video rounded-lg overflow-hidden cursor-pointer border border-transparent hover:border-immersive-gold shadow-lg shadow-black/50" 
                                onClick={() => addClip(clip)}
                                onMouseEnter={(e) => {
                                  const video = e.currentTarget.querySelector('video');
                                  if (video) {
                                    video.play().catch(() => {
                                      // Handle or silence interrupted play requests
                                    });
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  const video = e.currentTarget.querySelector('video');
                                  if (video) {
                                    video.pause();
                                    video.currentTime = 0;
                                  }
                                }}
                              >
                                <img 
                                  src={clip.thumbnail} 
                                  className="absolute inset-0 object-cover w-full h-full transition-opacity duration-300 group-hover:opacity-0" 
                                  referrerPolicy="no-referrer" 
                                />
                                <video 
                                  src={clip.url} 
                                  className="absolute inset-0 object-cover w-full h-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                                  muted 
                                  loop 
                                  playsInline
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-10">
                                  <Plus className="text-immersive-gold drop-shadow-lg" size={32} />
                                </div>
                                <div className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-mono text-white/80 z-20">
                                  {Math.floor(clip.duration / 60)}:{Math.floor(clip.duration % 60).toString().padStart(2, '0')}
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          {searchResults.length > 0 && (
                            <div className="pt-4 flex justify-center">
                              <Button 
                                onClick={loadMoreVideos}
                                disabled={isLoadingMore}
                                variant="outline"
                                className="border-immersive-gold/20 text-immersive-gold hover:bg-immersive-gold/10 px-12 rounded-xl group"
                              >
                                {isLoadingMore ? (
                                  <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-immersive-gold/30 border-t-immersive-gold rounded-full animate-spin" />
                                    <span>{settings.language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</span>
                                  </div>
                                ) : (
                                  <span className="flex items-center gap-2">
                                    <Plus size={16} className="group-hover:rotate-90 transition-transform" />
                                    {settings.language === 'ar' ? 'إظهار المزيد من الفيديوهات' : 'Show More Videos'}
                                  </span>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </ScrollArea>
                  </Card>

                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-immersive-gold uppercase tracking-widest">
                      {settings.language === 'ar' ? 'المقاطع المختارة' : 'Selected Clips'}
                    </h3>
                    <ScrollArea className="h-[380px] pr-4">
                      <div className="space-y-3">
                        {clips.map((clip, idx) => (
                          <div key={idx} className="flex flex-col gap-2 bg-black/40 p-3 rounded-xl border border-zinc-800 group transition-all hover:bg-black/60 shadow-lg shadow-black/20">
                            <div className="flex gap-3">
                              <img src={clip.thumbnail} className="w-20 h-12 object-cover rounded-lg ring-1 ring-white/10" referrerPolicy="no-referrer" />
                              <div className="flex-grow flex flex-col justify-center">
                                <span className="text-[10px] font-bold text-immersive-gold uppercase tracking-tighter">
                                  {settings.language === 'ar' ? `المقطع رقم ${idx + 1}` : `Clip #${idx + 1}`}
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <Input 
                                    type="number" 
                                    value={clip.duration ?? 5} 
                                    onChange={(e) => updateClipDuration(idx, parseInt(e.target.value) || 1)}
                                    className="w-16 h-7 text-[10px] bg-black/40 border-zinc-800 text-center px-1 font-mono focus:border-immersive-gold"
                                  />
                                  <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
                                    {settings.language === 'ar' ? 'ثانية' : 'sec'}
                                  </span>
                                </div>
                              </div>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => setClips(clips.filter((_, i) => i !== idx))} 
                                className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-all rounded-full h-8 w-8"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                            <div className="px-1 pt-1">
                              <Slider 
                                value={[clip.duration ?? 5]} 
                                max={Math.max(60, clip.duration * 2)} 
                                min={1} 
                                step={1} 
                                onValueChange={(val) => updateClipDuration(idx, val[0])}
                                className="opacity-30 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={prevStep} className="border-zinc-800">
                        {settings.language === 'ar' ? 'رجوع' : 'Back'}
                      </Button>
                      <Button onClick={nextStep} disabled={clips.length === 0} className="bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 font-bold">
                        {settings.language === 'ar' ? 'تم الاختيار' : 'Done Picking'}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div 
                key="step4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="grid grid-cols-1 lg:grid-cols-4 gap-6"
              >
                {/* LEFT SIDEBAR: VISUALS & STYLE */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto max-h-[85vh] pr-2 custom-scrollbar">
                  <div className="p-4 bg-black/20 border border-white/5 rounded-2xl space-y-6">
                    <h2 className="text-lg font-bold text-immersive-gold uppercase tracking-tighter flex items-center gap-2">
                       <Zap size={18} />
                       {settings.language === 'ar' ? 'التنسيق والستايل' : 'Visuals & Style'}
                    </h2>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 block">
                          {settings.language === 'ar' ? 'خيارات العرض' : 'Visibility Options'}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button 
                            variant={settings.showTranslation !== false ? 'default' : 'outline'}
                            onClick={() => setSettings(s => ({ ...s, showTranslation: !s.showTranslation }))}
                            className={cn(settings.showTranslation !== false ? "bg-immersive-gold text-immersive-bg" : "border-zinc-800", "text-[10px] h-8 font-bold")}
                          >
                            {settings.language === 'ar' ? 'الترجمة' : 'Translation'}
                          </Button>
                          <Button 
                            variant={settings.showCitation !== false ? 'default' : 'outline'}
                            onClick={() => setSettings(s => ({ ...s, showCitation: !s.showCitation }))}
                            className={cn(settings.showCitation !== false ? "bg-immersive-gold text-immersive-bg" : "border-zinc-800", "text-[10px] h-8 font-bold")}
                          >
                            {settings.language === 'ar' ? 'المرجع' : 'Citation'}
                          </Button>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 block">
                          {settings.language === 'ar' ? 'الألوان والتنسيق' : 'Colors & Styling'}
                        </label>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5">
                             <span className="text-[9px] text-zinc-400 uppercase font-bold">{settings.language === 'ar' ? 'لون العربي' : 'Ar Color'}</span>
                             <input 
                               type="color" 
                               value={settings.arColor || '#ffffff'} 
                               onChange={(e) => setSettings(s => ({...s, arColor: e.target.value}))}
                               className="w-6 h-6 p-0 bg-transparent border-none cursor-pointer rounded overflow-hidden"
                             />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5">
                             <span className="text-[9px] text-zinc-400 uppercase font-bold">{settings.language === 'ar' ? 'لون الترجمة' : 'En Color'}</span>
                             <input 
                               type="color" 
                               value={settings.enColor || '#ffffff'} 
                               onChange={(e) => setSettings(s => ({...s, enColor: e.target.value}))}
                               className="w-6 h-6 p-0 bg-transparent border-none cursor-pointer rounded overflow-hidden"
                             />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5">
                             <span className="text-[9px] text-zinc-400 uppercase font-bold">{settings.language === 'ar' ? 'لون الخلفية' : 'Box Color'}</span>
                             <input 
                               type="color" 
                               value={settings.boxColor || '#000000'} 
                               onChange={(e) => setSettings(s => ({...s, boxColor: e.target.value}))}
                               className="w-6 h-6 p-0 bg-transparent border-none cursor-pointer rounded overflow-hidden"
                             />
                          </div>
                          
                          <div className="pt-2">
                             <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">
                                  {settings.language === 'ar' ? 'إطار ذهبي' : 'Golden Border'}
                                </span>
                                <Button
                                  size="sm"
                                  variant={settings.showBorder ? 'default' : 'outline'}
                                  onClick={() => setSettings(s => ({...s, showBorder: !s.showBorder}))}
                                  className={cn(
                                    "h-6 px-3 text-[9px] font-bold uppercase transition-all",
                                    settings.showBorder 
                                      ? "bg-immersive-gold text-immersive-bg border-none" 
                                      : "border-zinc-800 text-zinc-400"
                                  )}
                                >
                                  {settings.showBorder ? (settings.language === 'ar' ? 'مفعل' : 'On') : (settings.language === 'ar' ? 'معطل' : 'Off')}
                                </Button>
                             </div>
                             
                             <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] text-zinc-400 uppercase font-bold">
                                    {settings.language === 'ar' ? 'الشفافية' : 'Opacity'}
                                  </span>
                                  <span className="text-[9px] font-mono text-immersive-gold font-bold">{settings.boxOpacity ?? 0}%</span>
                                </div>
                                
                                {/* Quick Presets */}
                                <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-white/5">
                                  {[0, 25, 50, 75, 100].map((val) => (
                                    <button
                                      key={val}
                                      onClick={() => setSettings(s => ({...s, boxOpacity: val}))}
                                      className={cn(
                                        "flex-1 py-1.5 text-[8px] font-bold rounded-md transition-all",
                                        (settings.boxOpacity ?? 0) === val 
                                          ? "bg-immersive-gold text-immersive-bg shadow-sm" 
                                          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                                      )}
                                    >
                                      {val}%
                                    </button>
                                  ))}
                                </div>
                                <Slider 
                                  value={[settings.boxOpacity ?? 0]} 
                                  max={100} 
                                  min={0} 
                                  step={5} 
                                  onValueChange={(val) => setSettings(s => ({...s, boxOpacity: val[0]}))}
                                  className="py-1"
                                />
                             </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">
                            {settings.language === 'ar' ? 'الفلاتر' : 'Filters'}
                          </label>
                          <Select value={settings.filter ?? "none"} onValueChange={(val: any) => setSettings(s => ({...s, filter: val}))}>
                            <SelectTrigger className="bg-black/40 border-zinc-800 h-8 text-[10px]">
                              <SelectValue placeholder="Filter" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-800 text-white">
                              <SelectItem value="none">{settings.language === 'ar' ? 'بدون' : 'None'}</SelectItem>
                              <SelectItem value="cinematic">Cinematic</SelectItem>
                              <SelectItem value="grayscale">BW</SelectItem>
                              <SelectItem value="vintage">Vintage</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">
                            {settings.language === 'ar' ? 'المؤثرات' : 'Effects'}
                          </label>
                          <Select value={settings.effect ?? "none"} onValueChange={(val: any) => setSettings(s => ({...s, effect: val}))}>
                            <SelectTrigger className="bg-black/40 border-zinc-800 h-8 text-[10px]">
                              <SelectValue placeholder="Effect" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-800 text-white">
                              <SelectItem value="none">{settings.language === 'ar' ? 'بدون' : 'None'}</SelectItem>
                              <SelectItem value="vignette">Edges</SelectItem>
                              <SelectItem value="glow">Glow</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">
                          {settings.language === 'ar' ? 'حركة النص' : 'Text Animation'}
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'none', labelAr: 'بدون', labelEn: 'None' },
                            { id: 'fade', labelAr: 'تلاشي', labelEn: 'Fade' },
                            { id: 'slide-up', labelAr: 'صعود', labelEn: 'Raise' },
                            { id: 'zoom', labelAr: 'زوم', labelEn: 'Zoom' },
                            { id: 'typewriter', labelAr: 'كتابة', labelEn: 'Type' }
                          ].map((anim) => (
                            <Button 
                              key={anim.id}
                              size="sm"
                              variant={settings.animationPreset === anim.id ? 'default' : 'outline'}
                              onClick={() => setSettings(s => ({...s, animationPreset: anim.id as any}))}
                              className={cn(
                                "h-8 text-[9px] font-bold px-1 transition-all", 
                                settings.animationPreset === anim.id 
                                  ? "bg-immersive-gold text-immersive-bg border-none" 
                                  : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                              )}
                            >
                              {settings.language === 'ar' ? anim.labelAr : anim.labelEn}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-2 space-y-4">
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">
                            {settings.language === 'ar' ? 'جودة الفيديو' : 'Video Quality'}
                          </label>
                          <div className="grid grid-cols-2 gap-1">
                            {['4k', '2k', '1080p', '720p'].map((q) => (
                              <Button 
                                key={q}
                                size="sm"
                                variant={settings.quality === q ? 'default' : 'outline'}
                                onClick={() => setSettings(s => ({...s, quality: q as any}))}
                                className={cn("h-7 text-[10px] font-bold", settings.quality === q ? "bg-immersive-gold text-immersive-bg" : "border-zinc-800 text-zinc-400")}
                              >
                                {q}
                              </Button>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 block">
                            {settings.language === 'ar' ? 'أبعاد الفيديو' : 'Video Dimensions'}
                          </label>
                          <div className="grid grid-cols-2 gap-1">
                            {['16:9', '9:16', '1:1', '4:5'].map((d) => (
                              <Button 
                                key={d}
                                size="sm"
                                variant={settings.dimensions === d ? 'default' : 'outline'}
                                onClick={() => setSettings(s => ({...s, dimensions: d as any}))}
                                className={cn("h-7 text-[10px] font-bold", settings.dimensions === d ? "bg-immersive-gold text-immersive-bg" : "border-zinc-800 text-zinc-400")}
                              >
                                {d}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CENTER: PREVIEW AREA */}
                <div className="lg:col-span-2 flex flex-col justify-start gap-6">
                  <div 
                    ref={previewRef}
                    className={cn(
                    "bg-black rounded-3xl overflow-hidden shadow-2xl relative border border-immersive-gold/20 shadow-black/50 group mx-auto transition-all duration-500",
                    settings.dimensions === '16:9' ? "aspect-video w-full" : 
                    settings.dimensions === '9:16' ? "aspect-[9/16] h-[600px]" :
                    settings.dimensions === '1:1' ? "aspect-square h-[500px]" :
                    "aspect-[4/5] h-[580px]"
                  )}>
                    {/* Filtered Container */}
                    <div className="absolute inset-0 z-0 transition-all duration-700" style={{ filter: getFilterStyle() }}>
                      {/* Preview Player */}
                      {isPreviewPlaying ? (
                        <div className="absolute inset-0">
                          {plannedClips.map((clip, idx) => {
                            const isActive = activeClipIndex === idx;
                            const isNeighbor = Math.abs(activeClipIndex - idx) <= 1;
                            if (!isNeighbor) return null;
                            return (
                              <video
                                key={`${clip.id}-${idx}`}
                                src={clip.url}
                                className={cn(
                                  "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                                  isActive ? "opacity-60" : "opacity-0"
                                )}
                                muted
                                autoPlay
                                loop
                                playsInline
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <img 
                          src={clips[0]?.thumbnail || "https://picsum.photos/seed/nature/800/450"} 
                          className="w-full h-full object-cover opacity-60 contrast-125" 
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>

                    {/* Effects Overlays */}
                    {settings.effect === 'vignette' && (
                      <div className="absolute inset-0 pointer-events-none z-[5] shadow-[inset_0_0_150px_rgba(0,0,0,0.8)]" />
                    )}
                    {settings.effect === 'grain' && (
                      <div className="absolute inset-0 pointer-events-none z-[5] opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />
                    )}

                    {/* HIDDEN STABLE AUDIO ELEMENT */}
                    {audioFile && (
                      <audio
                        id="preview-audio"
                        key={audioFile}
                        src={`/uploads/${audioFile}`}
                        preload="auto"
                        onLoadedMetadata={(e) => {
                          const d = e.currentTarget.duration;
                          const currentAudioUrl = `/uploads/${audioFile}`;
                          // Only initialize if we don't have a duration OR if we just switched to a new file
                          if (d > 0 && (!settings.audio?.duration || settings.audio.url !== currentAudioUrl)) {
                             setSettings(prev => ({ 
                               ...prev, 
                               audio: { 
                                 ...(prev.audio || { startTime: 0 }), 
                                 url: currentAudioUrl,
                                 duration: d 
                               } 
                             }));
                          }
                        }}
                        onTimeUpdate={(e) => {
                          const el = e.currentTarget;
                          const start = settings.audio?.startTime || 0;
                          const dur = settings.audio?.duration || 0;
                          
                          // Auto stop when reaching selection end
                          if (dur > 0 && el.currentTime >= start + dur) {
                             el.pause();
                             el.currentTime = start;
                             setIsPreviewPlaying(false);
                          }

                          const relativeTime = el.currentTime - start;
                          setPreviewTime(relativeTime);
                        }}
                        onEnded={() => setIsPreviewPlaying(false)}
                        onPlay={() => setIsPreviewPlaying(true)}
                        onPause={() => setIsPreviewPlaying(false)}
                        className="hidden"
                      />
                    )}

                    <div className="absolute inset-0 z-10 pointer-events-none">
                      <AnimatePresence mode="wait">
                        {activeVerse && (
                          <div 
                            className="relative w-full h-full" 
                            key={activeVerse.number}
                          >
                            {/* ARABIC TEXT */}
                            <motion.p 
                              key={`ar-${activeVerse.number}`}
                                initial={
                                  settings.animationPreset === 'fade' ? { opacity: 0, x: "-50%", y: "-50%" } :
                                  settings.animationPreset === 'slide-up' ? { opacity: 0, x: "-50%", y: "0%" } :
                                  settings.animationPreset === 'zoom' ? { opacity: 0, scale: 0.5, x: "-50%", y: "-50%" } :
                                  settings.animationPreset === 'typewriter' ? { opacity: 0, x: "-50%", y: "-50%" } :
                                  { opacity: 1, x: "-50%", y: "-50%" }
                                }
                                animate={
                                  settings.animationPreset === 'fade' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                  settings.animationPreset === 'slide-up' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                  settings.animationPreset === 'zoom' ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" } :
                                  settings.animationPreset === 'typewriter' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                  { opacity: 1, x: "-50%", y: "-50%" }
                                }
                                exit={{ 
                                  opacity: 0, 
                                  scale: settings.animationPreset === 'zoom' ? 0.8 : 1,
                                  transition: { duration: 0.3 } 
                                }}
                                transition={{
                                  duration: 0.8,
                                  ease: [0.16, 1, 0.3, 1]
                                }}
                                drag={isPositioningMode}
                                dragMomentum={false}
                                onDragEnd={(_, info) => {
                                  if (!previewRef.current) return;
                                  const rect = previewRef.current.getBoundingClientRect();
                                  const x = (info.point.x - rect.left) / rect.width;
                                  const y = (info.point.y - rect.top) / rect.height;
                                  setSettings(s => ({ ...s, textPosition: { x, y } }));
                                }}
                                className={cn(
                                  "font-quran leading-tight drop-shadow-2xl p-4",
                                  "rounded-[30px] backdrop-blur-md transition-shadow",
                                  settings.showBorder ? "border border-white/20" : "border-none",
                                  isPositioningMode && "cursor-move pointer-events-auto ring-2 ring-immersive-gold/50 ring-offset-4 ring-offset-black/50"
                                )}
                                style={{ 
                                  color: settings.arColor || '#ffffff',
                                  backgroundColor: hexToRgba(settings.boxColor || '#000000', settings.boxOpacity ?? 50),
                                  fontSize: `${getVisualFontSize(settings.fontSize || 16)}px`,
                                  position: 'absolute',
                                  left: settings.textPosition?.x !== undefined ? `${settings.textPosition.x * 100}%` : '50%',
                                  top: settings.textPosition?.y !== undefined ? `${settings.textPosition.y * 100}%` : '40%',
                                  textAlign: 'center',
                                  width: `${(100 - (settings.textMargin || 0) * 2) * ((settings.arWrapLimit || 100) / 100)}%`,
                                  maxWidth: `${(100 - (settings.textMargin || 0) * 2) * ((settings.arWrapLimit || 100) / 100)}%`,
                                  lineHeight: settings.lineSpacing || 1.6,
                                  zIndex: 20
                                }}
                              >
                                {activeVerse.text}
                              </motion.p>
      
                              {/* ENGLISH TRANSLATION */}
                              {settings.showTranslation !== false && activeVerse.translation && (
                                <motion.p 
                                  key={`en-${activeVerse.number}`}
                                  initial={
                                    settings.animationPreset === 'fade' ? { opacity: 0, x: "-50%", y: "-50%" } :
                                    settings.animationPreset === 'slide-up' ? { opacity: 0, x: "-50%", y: "-30%" } :
                                    settings.animationPreset === 'zoom' ? { opacity: 0, scale: 0.8, x: "-50%", y: "-50%" } :
                                    settings.animationPreset === 'typewriter' ? { opacity: 0, x: "-50%", y: "-50%" } :
                                    { opacity: 1, x: "-50%", y: "-50%" }
                                  }
                                  animate={
                                    settings.animationPreset === 'fade' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                    settings.animationPreset === 'slide-up' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                    settings.animationPreset === 'zoom' ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" } :
                                    settings.animationPreset === 'typewriter' ? { opacity: 1, x: "-50%", y: "-50%" } :
                                    { opacity: 1, x: "-50%", y: "-50%" }
                                  }
                                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                                  transition={{
                                    duration: 0.6,
                                    delay: 0.2,
                                    ease: [0.16, 1, 0.3, 1]
                                  }}
                                  drag={isPositioningMode}
                                  dragMomentum={false}
                                  onDragEnd={(_, info) => {
                                    if (!previewRef.current) return;
                                    const rect = previewRef.current.getBoundingClientRect();
                                    const x = (info.point.x - rect.left) / rect.width;
                                    const y = (info.point.y - rect.top) / rect.height;
                                    setSettings(s => ({ ...s, translationPosition: { x, y } }));
                                  }}
                                  className={cn(
                                    "leading-snug font-sans drop-shadow-md p-4",
                                    "rounded-[20px] backdrop-blur-sm",
                                    settings.showBorder ? "border border-immersive-gold/30" : "border border-zinc-700/30",
                                    isPositioningMode && "cursor-move pointer-events-auto ring-2 ring-immersive-gold/30 ring-offset-2 ring-offset-black/50"
                                  )}
                                  style={{ 
                                    color: settings.enColor || '#ffffffcc',
                                    backgroundColor: hexToRgba(settings.boxColor || '#000000', settings.boxOpacity ?? 40),
                                    fontSize: `${getVisualFontSize((settings.fontSize || 16) * 0.55)}px`,
                                    position: 'absolute',
                                    left: settings.translationPosition?.x !== undefined ? `${settings.translationPosition.x * 100}%` : '50%',
                                    top: settings.translationPosition?.y !== undefined ? `${settings.translationPosition.y * 100}%` : '75%',
                                    textAlign: 'center',
                                    width: `${(100 - (settings.textMargin || 0) * 2) * ((settings.enWrapLimit || 100) / 100)}%`,
                                    maxWidth: `${(100 - (settings.textMargin || 0) * 2) * ((settings.enWrapLimit || 100) / 100)}%`,
                                    lineHeight: settings.lineSpacing ? settings.lineSpacing * 0.9 : 1.4,
                                    zIndex: 15
                                  }}
                                >
                                  {activeVerse.translation}
                                </motion.p>
                              )}
                              
                              {/* CITATION */}
                              {settings.showCitation !== false && (
                                <motion.div 
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 0.9 }}
                                  exit={{ opacity: 0 }}
                                  className="absolute top-[90%] left-1/2 -translate-x-1/2 -translate-y-1/2 font-sans tracking-[0.2em] uppercase pointer-events-none drop-shadow-sm font-bold"
                                  style={{ 
                                    fontSize: `${getVisualFontSize(settings.fontSize * 0.4)}px`,
                                    color: settings.citationColor || '#D4AF37'
                                  }}
                                >
                                  <span>[{activeVerse.surahName}: {activeVerse.number}]</span>
                                </motion.div>
                              )}
                            </div>
                          )}
                        </AnimatePresence>

                      {!activeVerse && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40">
                          <Play size={48} className="text-white mb-4" />
                          <p className="text-xs uppercase tracking-[0.3em] font-bold text-white">
                            {settings.language === 'ar' ? 'اضغط للمعاينة' : 'Click to Preview'}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Play/Pause Button Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 cursor-pointer"
                      onClick={() => {
                        const audio = document.getElementById('preview-audio') as HTMLAudioElement;
                        if (!audio) return;
                        if (audio.paused) {
                          if (audio.currentTime < (settings.audio?.startTime || 0) || audio.currentTime > (settings.audio?.startTime || 0) + (settings.audio?.duration || 1000)) {
                            audio.currentTime = settings.audio?.startTime || 0;
                          }
                          setPreviewTime(audio.currentTime - (settings.audio?.startTime || 0));
                          audio.play().catch(() => {});
                        } else {
                          audio.pause();
                        }
                      }}
                    >
                      <div className="w-20 h-20 rounded-full bg-immersive-gold/20 backdrop-blur-md border border-immersive-gold/40 flex items-center justify-center text-immersive-gold shadow-2xl">
                        {isPreviewPlaying ? <Pause size={40} /> : <Play size={40} className="ml-1" />}
                      </div>
                    </div>

                    {/* Simple Progress Bar */}
                    {isPreviewPlaying && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-30">
                        <motion.div 
                          className="h-full bg-immersive-gold"
                          initial={{ width: 0 }}
                          animate={{ width: `${(previewTime / (settings.audio?.duration || 30)) * 100}%` }}
                          transition={{ duration: 0.1 }}
                        />
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-between">
                    <Button variant="outline" onClick={prevStep} className="border-zinc-800 h-14 px-8">
                      {settings.language === 'ar' ? 'رجوع' : 'Back'}
                    </Button>
                    <Button 
                      onClick={generateVideo} 
                      disabled={isGenerating}
                      className="bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 px-12 h-14 text-lg font-bold gap-3 shadow-lg gold-glow min-w-[240px]"
                    >
                      {isGenerating ? (
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-2">
                             <div className="w-4 h-4 border-2 border-immersive-bg/30 border-t-immersive-bg rounded-full animate-spin" />
                             <span>{generationProgress}%</span>
                          </div>
                          <span className="text-[10px] opacity-70 uppercase tracking-tighter">
                            {generationStatus === 'downloading' ? (settings.language === 'ar' ? 'جاري التحميل...' : 'Downloading...') :
                             generationStatus === 'processing' ? (settings.language === 'ar' ? 'جاري المعالجة...' : 'Processing...') :
                             generationStatus === 'analyzing' ? (settings.language === 'ar' ? 'جاري التحليل...' : 'Analyzing...') :
                             (settings.language === 'ar' ? 'جارٍ البدء...' : 'Starting...')}
                          </span>
                        </div>
                      ) : (
                        <>
                          <Play size={20} />
                          {settings.language === 'ar' ? 'بدء التصميم' : 'Process Video'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* RIGHT SIDEBAR: TYPOGRAPHY & LAYOUT */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto max-h-[85vh] pl-2 custom-scrollbar">
                  <div className="p-4 bg-black/20 border border-white/5 rounded-2xl space-y-8">
                    <h2 className="text-lg font-bold text-immersive-gold uppercase tracking-tighter flex items-center gap-2">
                       <TypeIcon size={18} />
                       {settings.language === 'ar' ? 'تخطيط النص' : 'Typography & Layout'}
                    </h2>

                    <div className="space-y-8">
                      <div>
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                              {settings.language === 'ar' ? 'حجم الخط' : 'Font Size'}
                            </label>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-4 w-4 text-zinc-600 hover:text-immersive-gold p-0" 
                              onClick={() => setSettings(s => ({...s, fontSize: 16}))}
                              title={settings.language === 'ar' ? 'إعادة ضبط' : 'Reset'}
                            >
                              <RotateCcw size={10} />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input 
                              type="number" 
                              value={Number.isNaN(settings.fontSize) || settings.fontSize === undefined ? "" : settings.fontSize} 
                              onChange={(e) => setSettings(s => ({...s, fontSize: Math.min(200, Math.max(2, parseInt(e.target.value) || 16))}))}
                              className="w-12 h-6 text-[10px] bg-black/40 border-zinc-800 text-center px-1"
                            />
                            <span className="text-[10px] text-immersive-gold font-bold uppercase">px</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-7 w-7 border-zinc-800" onClick={() => setSettings(s => ({...s, fontSize: Math.max(2, (s.fontSize || 16) - 4)}))}> - </Button>
                          <Slider 
                            className="flex-grow"
                            value={[Number.isNaN(settings.fontSize) || settings.fontSize === undefined ? 16 : settings.fontSize]} 
                            max={200} 
                            min={2} 
                            step={1} 
                            onValueChange={(val: number[]) => setSettings(s => ({...s, fontSize: val[0]}))}
                          />
                          <Button variant="outline" size="icon" className="h-7 w-7 border-zinc-800" onClick={() => setSettings(s => ({...s, fontSize: Math.min(200, (s.fontSize || 16) + 4)}))}> + </Button>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-4">
                          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                            {settings.language === 'ar' ? 'هامش النص' : 'Text Margin'}
                          </label>
                          <div className="flex items-center gap-2">
                            <Input 
                              type="number" 
                              value={Number.isNaN(settings.textMargin) || settings.textMargin === undefined ? "" : settings.textMargin} 
                              onChange={(e) => setSettings(s => ({...s, textMargin: Math.min(45, Math.max(0, parseInt(e.target.value) || 0))}))}
                              className="w-12 h-6 text-[10px] bg-black/40 border-zinc-800 text-center px-1"
                            />
                            <span className="text-[10px] text-immersive-gold font-bold uppercase">%</span>
                          </div>
                        </div>
                        <Slider 
                          value={[Number.isNaN(settings.textMargin) || settings.textMargin === undefined ? 2 : settings.textMargin]} 
                          max={45} 
                          min={0} 
                          step={1} 
                          onValueChange={(val) => setSettings(s => ({...s, textMargin: val[0]}))}
                        />
                      </div>

                      <div className="pt-4 border-t border-zinc-800/50 mt-4 space-y-6">
                        <div className="space-y-6">
                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                {settings.language === 'ar' ? 'عرض السطر العربي' : 'Arabic Width'}
                              </label>
                              <div className="flex items-center gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 text-[8px] px-1 hover:bg-immersive-gold/10 hover:text-immersive-gold"
                                  onClick={() => setSettings(s => ({ ...s, arWrapLimit: 200 }))}
                                >
                                  200%
                                </Button>
                                <span className="text-[9px] font-mono text-immersive-gold">{settings.arWrapLimit || 100}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, arWrapLimit: Math.max(10, (s.arWrapLimit || 100) - 5)}))}> - </Button>
                              <Slider className="flex-grow" value={[settings.arWrapLimit || 100]} max={200} min={10} step={1} onValueChange={(val) => setSettings(s => ({...s, arWrapLimit: val[0]}))} />
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, arWrapLimit: Math.min(200, (s.arWrapLimit || 100) + 5)}))}> + </Button>
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                {settings.language === 'ar' ? 'عرض الترجمة' : 'English Width'}
                              </label>
                              <span className="text-[9px] font-mono text-immersive-gold">{settings.enWrapLimit || 100}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, enWrapLimit: Math.max(10, (s.enWrapLimit || 100) - 5)}))}> - </Button>
                              <Slider className="flex-grow" value={[settings.enWrapLimit || 100]} max={100} min={10} step={1} onValueChange={(val) => setSettings(s => ({...s, enWrapLimit: val[0]}))} />
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, enWrapLimit: Math.min(100, (s.enWrapLimit || 100) + 5)}))}> + </Button>
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                {settings.language === 'ar' ? 'تباعد الأسطر' : 'Line Spacing'}
                              </label>
                              <span className="text-[9px] font-mono text-immersive-gold">{settings.lineSpacing || 1.6}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, lineSpacing: Math.max(0.5, Math.round(((s.lineSpacing || 1.6) - 0.1) * 10) / 10)}))}> - </Button>
                              <Slider className="flex-grow" value={[settings.lineSpacing || 1.6]} max={4.0} min={0.5} step={0.1} onValueChange={(val) => setSettings(s => ({...s, lineSpacing: val[0]}))} />
                              <Button variant="outline" size="icon" className="h-6 w-6 border-zinc-800" onClick={() => setSettings(s => ({...s, lineSpacing: Math.min(4, Math.round(((s.lineSpacing || 1.6) + 0.1) * 10) / 10)}))}> + </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t border-zinc-800/50">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 block">
                          {settings.language === 'ar' ? 'تحريك النص' : 'Text Placement'}
                        </label>
                        <div className="flex flex-col gap-3">
                          <Button 
                            variant={isPositioningMode ? 'default' : 'outline'}
                            onClick={() => setIsPositioningMode(!isPositioningMode)}
                            className={cn("w-full h-10 gap-2 text-xs", isPositioningMode ? "bg-immersive-gold text-immersive-bg" : "border-zinc-800")}
                          >
                            <Scissors size={14} className={isPositioningMode ? "animate-pulse" : ""} />
                            {isPositioningMode ? (settings.language === 'ar' ? 'إيقاف' : 'Stop') : (settings.language === 'ar' ? 'تحريك يدوي' : 'Manual')}
                          </Button>

                          {isPositioningMode && (
                            <div className="space-y-4 p-3 bg-immersive-gold/5 border border-immersive-gold/20 rounded-xl animate-in fade-in duration-500">
                              <div className="flex gap-1 p-1 bg-black/40 rounded-lg">
                                <Button size="sm" variant={selectedElement === 'ar' ? 'default' : 'ghost'} onClick={() => setSelectedElement('ar')} className={cn("flex-1 h-7 text-[8px] uppercase", selectedElement === 'ar' && "bg-immersive-gold text-immersive-bg")}>Ar</Button>
                                <Button size="sm" variant={selectedElement === 'en' ? 'default' : 'ghost'} onClick={() => setSelectedElement('en')} className={cn("flex-1 h-7 text-[8px] uppercase", selectedElement === 'en' && "bg-immersive-gold text-immersive-bg")}>En</Button>
                              </div>
                              <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
                                <div /><Button size="icon" variant="outline" className="h-7 w-7 border-zinc-800" onClick={() => moveElement('up')}><ChevronUp size={14} /></Button><div />
                                <Button size="icon" variant="outline" className="h-7 w-7 border-zinc-800" onClick={() => moveElement('left')}><ChevronLeft size={14} /></Button>
                                <div className="flex items-center justify-center"><Zap className="text-immersive-gold/30" size={10} /></div>
                                <Button size="icon" variant="outline" className="h-7 w-7 border-zinc-800" onClick={() => moveElement('right')}><ChevronRight size={14} /></Button>
                                <div /><Button size="icon" variant="outline" className="h-7 w-7 border-zinc-800" onClick={() => moveElement('down')}><ChevronDown size={14} /></Button><div />
                              </div>
                            </div>
                          )}

                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setSettings(s => ({ 
                              ...s, 
                              textPosition: { x: 0.5, y: 0.5 }, 
                              translationPosition: { x: 0.5, y: 0.8 }, 
                              textMargin: 0,
                              arWrapLimit: 135,
                              enWrapLimit: 100,
                              fontSize: 16,
                              lineSpacing: 1.4,
                              boxOpacity: 0
                            }))}
                            className="text-[9px] text-zinc-500 hover:text-white uppercase tracking-widest h-8"
                          >
                            <RotateCcw size={10} className="mr-2" />
                            {settings.language === 'ar' ? 'إعادة ضبط' : 'Reset All'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div 
                key="step5"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center py-12"
              >
                <div className="w-20 h-20 bg-immersive-gold/10 rounded-full flex items-center justify-center mb-8 text-immersive-gold gold-glow">
                  <Download size={40} />
                </div>
                <h2 className="text-4xl font-bold mb-4 text-immersive-gold">
                  {settings.language === 'ar' ? 'جاهز للتحميل!' : 'Ready to Download!'}
                </h2>
                <div className="max-w-md mb-8 space-y-4">
                  <p className="text-zinc-400">
                    {settings.language === 'ar' 
                      ? 'تم إنتاج الفيديو الخاص بك وهو جاهز للتحميل.' 
                      : 'Your video has been generated and is ready to download.'}
                  </p>
                  
                  <div className="bg-immersive-gold/5 border border-immersive-gold/20 rounded-xl p-4 text-sm text-left rtl:text-right">
                    <p className="text-immersive-gold font-bold mb-2 flex items-center gap-2">
                      <CheckCircle2 size={16} />
                      {settings.language === 'ar' ? 'ملاحظة هامة للتحميل:' : 'Important Download Note:'}
                    </p>
                    <p className="text-zinc-300 leading-relaxed">
                      {settings.language === 'ar' 
                        ? 'إذا ظهرت لك صفحة "Cookie Check"، اضغط على "Authenticate in new window". بعد إغلاق النافذة المنبثقة، عد إلى هنا واضغط على "تحميل الفيديو" مرة أخرى.' 
                        : 'If you see a "Cookie Check" page, click "Authenticate in new window". After closing the popup, return here and click "Download Video" again.'}
                    </p>
                    <Button 
                      variant="link" 
                      onClick={() => window.open('/', '_blank')}
                      className="text-immersive-gold p-0 h-auto text-xs mt-2 underline"
                    >
                      {settings.language === 'ar' ? 'حل مشكلة التحميل (فتح في نافذة جديدة)' : 'Fix Download (Open in new tab)'}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Button variant="outline" onClick={() => setStep(1)} className="h-14 px-8 border-zinc-800">
                    {settings.language === 'ar' ? 'تصميم فيديو جديد' : 'Design New Video'}
                  </Button>
                  <Button 
                    onClick={() => {
                      if (!resultId) return;
                      // Using a hidden anchor tag with download attribute for better compatibility
                      const link = document.createElement('a');
                      link.href = `/api/download/${resultId}.mp4`;
                      link.setAttribute('download', `QuranVideo_${resultId}.mp4`);
                      link.style.display = 'none';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="h-14 px-12 bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 rounded-lg flex items-center gap-3 font-bold shadow-xl gold-glow"
                  >
                    <Download size={20} />
                    {settings.language === 'ar' ? 'تحميل الفيديو الآن' : 'Download Video Now'}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Donation Section */}
      <footer className="mt-8 mb-4 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
        <Card className="glass-panel border-immersive-gold/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-immersive-gold/5 blur-3xl -z-10 group-hover:bg-immersive-gold/10 transition-all duration-500" />
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-immersive-gold/10 rounded-2xl flex items-center justify-center text-immersive-gold shrink-0 border border-immersive-gold/20 shadow-lg">
              <Heart size={28} className="animate-pulse" fill="currentColor" fillOpacity={0.2} />
            </div>
            <div>
              <h4 className="text-xl font-bold text-immersive-gold mb-1">
                {settings.language === 'ar' ? 'أدعم مطور التطبيق' : 'Support the Developer'}
              </h4>
              <p className="text-zinc-500 text-xs">
                {settings.language === 'ar' ? 'ساهم في استمرار وتطوير هذا المشروع التقني الدعوي' : 'Contribute to the continuation and development of this project'}
              </p>
            </div>
          </div>
                  <div className="flex flex-wrap justify-center gap-3">
                    {appConfig?.donations?.map((item) => (
                      <Button
                        key={item.name}
                        className={cn(
                          "h-10 px-4 rounded-xl gap-2 font-bold text-xs transition-all active:scale-95 shadow-lg",
                          "bg-black/40 border border-white/5 hover:border-immersive-gold/40"
                        )}
                        style={{ color: item.color }}
                        onClick={() => {
                          if (item.name.toUpperCase() === 'IBAN') {
                            setIsIbanModalOpen(true);
                          } else if (item.type === 'copy') {
                            handleCopy(item.value);
                          } else {
                            window.open(item.value, '_blank');
                          }
                        }}
                      >
                        <IconComponent name={item.icon} size={14} />
                        {item.name}
                        {item.type === 'copy' && <Copy size={12} className="opacity-50" />}
                        {item.name.toUpperCase() === 'IBAN' && <ExternalLink size={12} className="opacity-50" />}
                      </Button>
                    ))}
                  </div>
        </Card>
      </footer>

      {/* Support Modal */}
      <Dialog open={isSupportModalOpen} onOpenChange={setIsSupportModalOpen}>
        <DialogContent className="glass-panel border-immersive-gold/20 bg-immersive-bg/95 backdrop-blur-xl text-white max-w-md w-[90vw] rounded-2xl p-0 overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-immersive-gold to-transparent opacity-50" />
          
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-2xl font-bold text-immersive-gold flex items-center gap-3">
              <LifeBuoy size={24} />
              {settings.language === 'ar' ? 'الدعم الفني' : 'Technical Support'}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {settings.language === 'ar' ? 'أخبرنا عن مشكلتك أو استفسارك وسنرد عليك قريباً.' : 'Tell us about your problem or inquiry and we will reply soon.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSendSupport} className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                {settings.language === 'ar' ? 'الاسم' : 'Name'}
              </label>
              <Input 
                value={supportForm.name}
                onChange={e => setSupportForm(f => ({ ...f, name: e.target.value }))}
                placeholder={settings.language === 'ar' ? 'اسمك الكريم' : 'Your name'}
                className="bg-black/40 border-zinc-800 focus:border-immersive-gold/50 transition-colors"
                required
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                {settings.language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
              </label>
              <Input 
                type="email"
                value={supportForm.email}
                onChange={e => setSupportForm(f => ({ ...f, email: e.target.value }))}
                placeholder="example@mail.com"
                className="bg-black/40 border-zinc-800 focus:border-immersive-gold/50 transition-colors"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                {settings.language === 'ar' ? 'الرسالة' : 'Message'}
              </label>
              <Textarea 
                value={supportForm.message}
                onChange={e => setSupportForm(f => ({ ...f, message: e.target.value }))}
                placeholder={settings.language === 'ar' ? 'كيف يمكننا مساعدتك؟' : 'How can we help you?'}
                className="bg-black/40 border-zinc-800 focus:border-immersive-gold/50 min-h-[120px] transition-colors resize-none"
                required
              />
            </div>

            <DialogFooter className="pt-4 gap-2">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsSupportModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                {settings.language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button 
                type="submit" 
                disabled={isSendingSupport}
                className="bg-immersive-gold text-immersive-bg hover:bg-immersive-gold/90 font-bold px-8 shadow-lg transition-all active:scale-95"
              >
                {isSendingSupport ? (
                  <span className="flex items-center gap-2">
                    <RotateCcw size={14} className="animate-spin" />
                    {settings.language === 'ar' ? 'جاري الإرسال...' : 'Sending...'}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Mail size={16} />
                    {settings.language === 'ar' ? 'إرسال الرسالة' : 'Send Message'}
                  </span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* IBAN Info Modal */}
      <Dialog open={isIbanModalOpen} onOpenChange={setIsIbanModalOpen}>
        <DialogContent className="glass-panel border-immersive-gold/20 bg-immersive-bg/95 backdrop-blur-xl text-white max-w-md w-[90vw] rounded-2xl p-6 overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-immersive-gold to-transparent opacity-50" />
          
          <DialogHeader className="mb-6">
            <DialogTitle className="text-2xl font-bold text-immersive-gold flex items-center gap-3">
              <Building2 size={24} />
              {settings.language === 'ar' ? 'بيانات التحويل البنكي' : 'Bank Transfer Details'}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {settings.language === 'ar' ? 'اضغط على أي حقل لنسخه' : 'Click on any field to copy it'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div 
              className="p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-immersive-gold/30 transition-all group"
              onClick={() => handleCopy("Alaa Farouk Mohamed Ezz Abdallah")}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {settings.language === 'ar' ? 'اسم الحساب' : 'Account Name'}
                </span>
                <Copy size={12} className="text-immersive-gold opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-sm font-medium break-words">Alaa Farouk Mohamed Ezz Abdallah</p>
            </div>

            <div 
              className="p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-immersive-gold/30 transition-all group"
              onClick={() => handleCopy("EG650005301900000319135065001")}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {settings.language === 'ar' ? 'رقم الايبان' : 'IBAN'}
                </span>
                <Copy size={12} className="text-immersive-gold opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-sm font-mono break-all leading-relaxed">EG650005301900000319135065001</p>
            </div>

            <div 
              className="p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-immersive-gold/30 transition-all group"
              onClick={() => handleCopy("ALEXEGCXXXX")}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {settings.language === 'ar' ? 'سويفت كود' : 'SWIFT Code'}
                </span>
                <Copy size={12} className="text-immersive-gold opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-sm font-mono tracking-wider">ALEXEGCXXXX</p>
            </div>
          </div>

          <DialogFooter className="mt-8">
            <Button 
              className="w-full bg-immersive-gold text-immersive-bg font-bold h-11 rounded-xl"
              onClick={() => setIsIbanModalOpen(false)}
            >
              {settings.language === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Support Button - Smaller & Opens Modal */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1 }}
        className="fixed bottom-6 left-6 z-[60]"
      >
        <div className="group relative">
          <Button
            onClick={() => setIsSupportModalOpen(true)}
            size="icon"
            className="w-14 h-14 bg-zinc-900/90 backdrop-blur-xl border border-white/10 hover:border-immersive-gold/50 text-immersive-gold rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-immersive-gold/20"
          >
            <LifeBuoy size={28} className="group-hover:rotate-45 transition-transform duration-500" />
            <div className="absolute inset-0 bg-immersive-gold/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl -z-10" />
          </Button>
          
          {/* Tooltip-like label on hover */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap bg-zinc-900/90 border border-white/10 px-3 py-1.5 rounded-lg shadow-xl translate-x-2 group-hover:translate-x-0 transition-transform duration-300">
            <span className="text-[10px] font-bold text-immersive-gold uppercase tracking-widest">
              {settings.language === 'ar' ? 'الدعم الفني' : 'Tech Support'}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Atmospheric Background */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[20%] right-[10%] w-[40vw] h-[40vw] bg-emerald-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[10%] left-[5%] w-[30vw] h-[30vw] bg-cyan-900/10 blur-[100px] rounded-full" />
      </div>

    </div>
  );
}
