import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINK_ROWS, appendPlaybackLink, playbackLinkUrls } from '../src/ui/playback-links.js';

// Minimal DOM double: verify text/value rendering and the real click handler
// without adding a DOM dependency to this small frontend feature.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
  }
  append(...children) { this.children.push(...children); }
  querySelector() { return this.empty || null; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

const origin = 'https://ifallhub.test';
const attempt = {
  playback: { playback_url: '/api/media?token=abc&url=https%3A%2F%2Fcdn.test%2Fvideo.mpd', stream_type: 'dash' },
  release: { filename: '<img src=x onerror=alert(1)>', mirrors: [{ label: 'Primary' }, { label: 'Backup' }] },
  provider: 'moviebox',
  mirrorIndex: 1,
};

function setup(t, clipboard) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag) => new Element(tag) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  });
  return new Element('div');
}

test('shows absolute player URL, source and mirror safely; retains earlier attempts', (t) => {
  const container = setup(t);
  let emptyRemoved = false;
  container.empty = { remove: () => { emptyRemoved = true; } };
  appendPlaybackLink(container, attempt, origin);
  appendPlaybackLink(container, { ...attempt, playback: { url: 'https://cdn.test/video.mp4' } }, origin);
  assert.equal(emptyRemoved, true);
  assert.equal(container.children.length, 2);
  const [caption, input] = container.children[0].children[0].children;
  assert.equal(caption.textContent, 'Siddharth · <img src=x onerror=alert(1)> · Backup · DASH');
  assert.equal(caption.children.length, 0);
  assert.equal(input.value, new URL(attempt.playback.playback_url, origin).href);
  assert.equal(input.readOnly, true);
  assert.equal(container.children[1].children[0].children[1].value, 'https://cdn.test/video.mp4');
});

test('copy button copies the exact displayed URL and confirms success', async (t) => {
  let copied;
  const container = setup(t, { writeText: async (value) => { copied = value; } });
  appendPlaybackLink(container, attempt, origin);
  const [label, button] = container.children[0].children;
  await button.listeners.click();
  assert.equal(copied, label.children[1].value);
  assert.equal(button.textContent, 'Copied!');
});

test('clipboard denial or absence selects the URL for manual copying', async (t) => {
  const container = setup(t, { writeText: async () => { throw new Error('Denied'); } });
  appendPlaybackLink(container, attempt, origin);
  const [label, button] = container.children[0].children;
  await button.listeners.click();
  assert.equal(label.children[1].focused, true);
  assert.equal(label.children[1].selected, true);
  assert.equal(button.textContent, 'Select & copy manually');
  globalThis.navigator.clipboard = undefined;
  await button.listeners.click();
  assert.equal(button.textContent, 'Select & copy manually');
});

test('missing or unsafe URLs and detached page do not add rows', (t) => {
  const container = setup(t);
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', 'https://[invalid']) {
    appendPlaybackLink(container, { ...attempt, playback: { url } }, origin);
  }
  appendPlaybackLink(null, attempt, origin);
  assert.equal(container.children.length, 0);
});

test('an H.265/.mkv release is labelled with its note on the row', (t) => {
  const container = setup(t);
  const release = {
    filename: 'Movie.2024.2160p.WEB-DL.HEVC.mkv',
    codec: 'h265',
    mirrors: [{ label: 'Primary' }],
  };
  appendPlaybackLink(container, { ...attempt, release, mirrorIndex: 0, note: 'H.265/HEVC — mpv/VLC me chalega' }, origin);
  const [caption] = container.children[0].children[0].children;
  assert.equal(caption.children.length, 1);
  assert.equal(caption.children[0].className, 'playback-link-note');
  assert.equal(caption.children[0].textContent, '⚠ H.265/HEVC — mpv/VLC me chalega');
});

test('the same link is listed once and marked as retried', (t) => {
  const container = setup(t);
  appendPlaybackLink(container, attempt, origin);
  appendPlaybackLink(container, attempt, origin);
  appendPlaybackLink(container, attempt, origin);
  assert.equal(container.children.length, 1);
  const [caption] = container.children[0].children[0].children;
  assert.match(caption.textContent, /· retried ×2$/);
  assert.deepEqual(playbackLinkUrls(container), [new URL(attempt.playback.playback_url, origin).href]);
});

test('the panel keeps the newest MAX_LINK_ROWS links', (t) => {
  const container = setup(t);
  for (let index = 0; index < MAX_LINK_ROWS + 5; index += 1) {
    appendPlaybackLink(container, { ...attempt, playback: { url: `/api/media/token/${index}/video.m4s` } }, origin);
  }
  const urls = playbackLinkUrls(container);
  assert.equal(urls.length, MAX_LINK_ROWS);
  assert.equal(urls.at(-1), `${origin}/api/media/token/${MAX_LINK_ROWS + 4}/video.m4s`);
  assert.equal(urls.includes(`${origin}/api/media/token/0/video.m4s`), false);
});

test('playbackLinkUrls tolerates a detached panel', () => {
  assert.deepEqual(playbackLinkUrls(null), []);
});
