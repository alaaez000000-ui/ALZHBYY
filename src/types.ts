export interface VideoClip {
  id: number;
  url: string;
  thumbnail: string;
  duration: number;
}

export interface Verse {
  text: string;
  translation?: string;
  startTime: number;
  endTime: number;
  number: number;
  surahName?: string;
  ayahNumber?: number;
}

export interface AppSettings {
  fontSize: number;
  theme: 'dark' | 'light';
  language: 'ar' | 'en';
  quality: '720p' | '1080p' | '2k' | '4k';
  dimensions: '16:9' | '9:16' | '1:1' | '4:5';
  filter?: 'none' | 'cinematic' | 'grayscale' | 'sepia' | 'vintage' | 'warm' | 'cool';
  effect?: 'none' | 'vignette' | 'grain' | 'blur' | 'glow';
  textPosition?: { x: number; y: number };
  translationPosition?: { x: number; y: number };
  textMargin?: number;
  arColor?: string;
  enColor?: string;
  boxColor?: string;
  boxOpacity?: number;
  showTranslation?: boolean;
  showCitation?: boolean;
  citationColor?: string;
  showBorder?: boolean;
  arWrapLimit?: number;
  enWrapLimit?: number;
  lineSpacing?: number;
  animationPreset?: 'fade' | 'slide-up' | 'zoom' | 'typewriter' | 'none';
  audio?: {
    startTime: number;
    duration: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    normalize: boolean;
  };
}
