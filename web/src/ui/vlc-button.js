// VLC button component for opening streams in external VLC player
// Provides a button that copies the current playback URL for use in VLC/MPV

import { displayUiText } from '../lib/format.js';

let currentPlaybackUrl = null;
let currentReleaseInfo = null;

/**
 * Store the current playback URL and release info
 * Called when a stream starts playing or is attempted
 */
export function setCurrentPlayback(playback, release, provider, mirrorIndex = 0) {
  if (!playback?.playback_url && !playback?.url) {
    currentPlaybackUrl = null;
    currentReleaseInfo = null;
    return;
  }
  
  currentPlaybackUrl = playback.playback_url || playback.url;
  currentReleaseInfo = {
    release: release || {},
    provider: provider || '',
    mirrorIndex: mirrorIndex,
    quality: release?.quality || 'Unknown',
    filename: release?.filename || 'Stream',
    codec: release?.codec || '',
    streamType: playback.stream_type || 'file',
  };
}

/**
 * Clear the current playback URL
 */
export function clearCurrentPlayback() {
  currentPlaybackUrl = null;
  currentReleaseInfo = null;
}

/**
 * Get the current playback URL
 */
export function getCurrentPlaybackUrl() {
  return currentPlaybackUrl;
}

/**
 * Get the current release info
 */
export function getCurrentReleaseInfo() {
  return currentReleaseInfo;
}

/**
 * Check if there's a valid playback URL available
 */
export function hasPlaybackUrl() {
  return currentPlaybackUrl !== null;
}

/**
 * Copy the current playback URL to clipboard
 * Returns true if successful, false otherwise
 */
export async function copyPlaybackUrl() {
  if (!currentPlaybackUrl) {
    return false;
  }
  
  try {
    await navigator.clipboard.writeText(currentPlaybackUrl);
    return true;
  } catch (error) {
    console.error('Failed to copy URL:', error);
    return false;
  }
}

/**
 * Create a VLC button element
 * @param {Object} options - Button options
 * @param {string} options.text - Button text (default: 'Open in VLC')
 * @param {string} options.className - Additional CSS classes
 * @param {function} options.onClick - Custom click handler
 * @returns {HTMLElement} The button element
 */
export function createVlcButton(options = {}) {
  const text = options.text || 'Open in VLC';
  const className = options.className || '';
  
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `vlc-button ${className}`.trim();
  button.innerHTML = `
    <svg class="vlc-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z"/>
      <path d="M10 17l5-5-5-5v10z" fill="currentColor"/>
    </svg>
    <span>${text}</span>
  `;
  
  button.addEventListener('click', async () => {
    if (options.onClick) {
      options.onClick();
      return;
    }
    
    await handleVlcButtonClick(button);
  });
  
  return button;
}

/**
 * Handle VLC button click
 * Copies the URL and shows feedback
 */
export async function handleVlcButtonClick(button) {
  if (!hasPlaybackUrl()) {
    showVlcToast('No playback URL available. Start a stream first.', 'error');
    return false;
  }
  
  const copied = await copyPlaybackUrl();
  
  if (copied) {
    showVlcToast('URL copied! Open VLC → Media → Open Network Stream → Paste → Play', 'success');
    
    // Update button text temporarily
    const originalText = button.querySelector('span').textContent;
    button.querySelector('span').textContent = 'Copied!';
    
    setTimeout(() => {
      button.querySelector('span').textContent = originalText;
    }, 2000);
    
    return true;
  } else {
    // Fallback: Select the URL for manual copying
    const url = getCurrentPlaybackUrl();
    const releaseInfo = getCurrentReleaseInfo();
    
    // Create a temporary input for selection
    const tempInput = document.createElement('input');
    tempInput.value = url;
    tempInput.style.position = 'fixed';
    tempInput.style.opacity = '0';
    tempInput.style.pointerEvents = 'none';
    document.body.appendChild(tempInput);
    tempInput.select();
    
    try {
      document.execCommand('copy');
      showVlcToast('URL selected! Press Ctrl+C to copy, then open in VLC', 'info');
    } catch {
      showVlcToast('Could not copy. URL: ' + url.substring(0, 50) + '...', 'error');
    } finally {
      document.body.removeChild(tempInput);
    }
    
    return false;
  }
}

/**
 * Show a toast notification for VLC operations
 */
export function showVlcToast(message, type = 'info') {
  const toast = document.getElementById('vlc-toast') || createToastContainer();
  
  // Clear existing timeout
  if (toast._timeout) {
    clearTimeout(toast._timeout);
  }
  
  toast.textContent = message;
  toast.className = `vlc-toast vlc-toast-${type}`;
  toast.hidden = false;
  
  // Auto-hide after 5 seconds
  toast._timeout = setTimeout(() => {
    toast.hidden = true;
    toast._timeout = null;
  }, 5000);
}

/**
 * Create the toast container element
 */
function createToastContainer() {
  const toast = document.createElement('div');
  toast.id = 'vlc-toast';
  toast.className = 'vlc-toast';
  toast.hidden = true;
  toast.role = 'status';
  toast.ariaLive = 'polite';
  
  document.body.appendChild(toast);
  
  // Add CSS if not already present
  if (!document.getElementById('vlc-toast-css')) {
    const style = document.createElement('style');
    style.id = 'vlc-toast-css';
    style.textContent = `
      .vlc-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        background: #1a1a1a;
        color: #fff;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        max-width: 400px;
        transition: opacity 0.2s, transform 0.2s;
      }
      .vlc-toast.hidden {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }
      .vlc-toast-success {
        border-left: 3px solid #22c55e;
      }
      .vlc-toast-error {
        border-left: 3px solid #ef4444;
        background: #2a0a0a;
      }
      .vlc-toast-info {
        border-left: 3px solid #3b82f6;
      }
      .vlc-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #444;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.2s;
      }
      .vlc-button:hover {
        background: #3a3a3a;
        border-color: #666;
      }
      .vlc-button:active {
        background: #4a4a4a;
      }
      .vlc-button .vlc-icon {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
      .vlc-button small {
        display: block;
        font-size: 10px;
        color: #888;
        margin-top: 2px;
      }
    `;
    document.head.appendChild(style);
  }
  
  return toast;
}

/**
 * Create a VLC button with additional info
 * Shows codec and quality information
 */
export function createVlcButtonWithInfo(options = {}) {
  const button = createVlcButton(options);
  
  // Add tooltip with instructions
  button.title = 'Copy link and open in VLC/MPV. Browser cannot play H.265/HEVC.';
  
  return button;
}

/**
 * Get VLC instructions based on the current release info
 */
export function getVlcInstructions() {
  const info = getCurrentReleaseInfo();
  
  if (!info) {
    return 'Start a stream first, then click "Open in VLC" to copy the URL.';
  }
  
  const lines = [
    `Stream: ${info.filename}`,
    `Quality: ${info.quality}`,
    `Codec: ${info.codec || 'Unknown'}`,
    `Type: ${info.streamType.toUpperCase()}`,
    '',
    'To play in VLC:',
    '1. Click "Open in VLC" to copy the URL',
    '2. Open VLC Media Player',
    '3. Media → Open Network Stream',
    '4. Paste the URL and click Play',
  ];
  
  return lines.join('\n');
}
