export interface CaptureOptions {
  url?: string;             // Mixamo URL (default: https://www.mixamo.com)
  character?: string;       // character search keyword
  animation?: string;       // animation search keyword
  frames: number;           // number of frames to capture
  fps?: number;             // playback fps for frame timing (default: 30)
  frameWidth?: number;      // output frame width px (default: 512)
  frameHeight?: number;     // output frame height px (default: 1024)
  outputDir: string;        // directory to save frames
  headless?: boolean;       // run headless (default: false for login)
  background?: string;      // canvas background color hex (default: #00FF00)
}

export interface CapturedFrame {
  index: number;
  path: string;
  timeMs: number;
}

export interface CaptureResult {
  frames: CapturedFrame[];
  frameWidth: number;
  frameHeight: number;
  stripPath?: string;       // path to assembled strip PNG (if assembled)
}

export interface PromptOptions {
  character: string;        // character description
  animation: string;        // animation name
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  style?: string;           // art style (default: "flat 2D anime")
  background?: string;      // background description (default: "solid bright green #00FF00")
}

export interface GeneratedPrompt {
  prompt: string;
  negative_prompt: string;
  aspect_ratio: string;     // e.g. "4:1" for 8 frames
  recommended_size: string; // e.g. "4096x1024"
}
