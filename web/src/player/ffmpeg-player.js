// FFmpeg.wasm-based H.265/HEVC decoder for browser playback
// This provides a fallback for streams that the browser cannot decode natively.
// NOTE: This is CPU-intensive and may not work well on mobile devices.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let isInitialized = false;
let initPromise = null;

/**
 * Initialize FFmpeg.wasm. Must be called before any decoding.
 * Loads the WASM module (~20-50MB) which may take time.
 */
export async function initFFmpeg() {
  if (isInitialized) return ffmpegInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      ffmpegInstance = new FFmpeg();
      
      // Load the WASM module from CDN
      // Using the core package from unpkg
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.2/dist/umd';
      
      await ffmpegInstance.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      isInitialized = true;
      console.log('FFmpeg.wasm initialized successfully');
      return ffmpegInstance;
    } catch (error) {
      console.error('Failed to initialize FFmpeg.wasm:', error);
      isInitialized = false;
      ffmpegInstance = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Check if FFmpeg.wasm is available and initialized
 */
export function isFFmpegAvailable() {
  return isInitialized && ffmpegInstance !== null;
}

/**
 * Check if the browser can potentially use FFmpeg.wasm
 * (has WebAssembly support and enough memory)
 */
export function canUseFFmpeg() {
  try {
    // Check WebAssembly support
    if (!window.WebAssembly) return false;
    
    // Check for sufficient memory (FFmpeg.wasm needs ~200MB+)
    if (window.navigator.deviceMemory && window.navigator.deviceMemory < 2) {
      return false; // Less than 2GB RAM
    }
    
    // Mobile devices typically don't have enough CPU
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a single video segment using FFmpeg.wasm
 * This is EXPERIMENTAL and CPU-intensive.
 * Returns decoded frames as Blob URLs that can be played.
 */
export async function decodeSegment(segmentUrl, options = {}) {
  const ffmpeg = await initFFmpeg();
  
  try {
    // Download the segment
    const response = await fetch(segmentUrl, { signal: options.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch segment: HTTP ${response.status}`);
    }
    
    const segmentData = await response.arrayBuffer();
    
    // Write to FFmpeg's virtual file system
    const inputFilename = 'input.m4s';
    await ffmpeg.writeFile(inputFilename, new Uint8Array(segmentData));
    
    // Determine output format based on input
    const outputFilename = 'output.mp4';
    
    // Run FFmpeg to decode and re-encode to H.264 (browser-compatible)
    // This is the most reliable approach for DASH segments
    await ffmpeg.exec([
      '-i', inputFilename,
      '-c:v', 'libx264',      // Re-encode video to H.264
      '-preset', 'ultrafast',  // Fastest encoding for real-time
      '-tune', 'zerolatency',
      '-crf', '23',            // Quality level
      '-c:a', 'aac',          // Keep or convert audio
      '-f', 'mp4',            // Output format
      '-movflags', 'frag_keyframe+empty_moov', // Enable streaming
      '-flush_packets', '1',
      outputFilename
    ]);
    
    // Read the decoded/transcoded file
    const outputData = await ffmpeg.readFile(outputFilename);
    
    // Create a Blob URL for playback
    const blob = new Blob([outputData], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    
    return {
      blobUrl,
      blob,
      cleanup: () => {
        URL.revokeObjectURL(blobUrl);
        ffmpeg.deleteFile(inputFilename);
        ffmpeg.deleteFile(outputFilename);
      }
    };
  } catch (error) {
    console.error('FFmpeg.wasm decoding failed:', error);
    throw error;
  }
}

/**
 * Create a proxy URL that decodes H.265 segments on-the-fly using FFmpeg.wasm
 * This is for DASH manifests that contain H.265 segments.
 * 
 * NOTE: This is EXTREMELY CPU-intensive and not suitable for production!
 * Each segment must be downloaded, decoded, and re-encoded.
 */
export function createFFmpegProxyUrl(manifestUrl, options = {}) {
  // For now, return the original URL since real-time transcoding is not feasible
  // This function is a placeholder for future implementation
  console.warn('FFmpeg.wasm proxy for DASH streams is not yet implemented for real-time playback');
  return manifestUrl;
}

/**
 * Check if a URL is likely H.265/HEVC
 */
export function isH265Url(url) {
  const lowerUrl = String(url || '').toLowerCase();
  return lowerUrl.includes('_h265_') || 
         lowerUrl.includes('hevc') || 
         lowerUrl.includes('h.265') ||
         lowerUrl.includes('x265') ||
         lowerUrl.includes('hvc1') ||
         lowerUrl.includes('hev1');
}

/**
 * Get FFmpeg.wasm version info
 */
export function getFFmpegVersion() {
  return {
    available: isInitialized,
    version: '0.12.2', // Version of @ffmpeg/core
    canUse: canUseFFmpeg(),
  };
}

/**
 * Cleanup FFmpeg.wasm resources
 */
export async function cleanupFFmpeg() {
  if (ffmpegInstance) {
    try {
      // Clean up all files in the virtual filesystem
      const files = await ffmpegInstance.listDir('/');
      for (const file of files) {
        try {
          await ffmpegInstance.deleteFile(`/${file.name}`);
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
  isInitialized = false;
  ffmpegInstance = null;
  initPromise = null;
}
