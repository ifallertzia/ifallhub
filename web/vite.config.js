import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Build-time neutral fallback catalog used ONLY when Vite runs with `--mode demo`
// (`npm run dev:demo`) so contributors and live previews can exercise every
// Sidify-V2 Movies/Series view, shelf, filter, and sheet without running the
// Rust engine. Production builds (`npm run build`) NEVER include this plugin and
// connect directly to Ifallhub's `/api/*` backend.
function makeMockApiPlugin() {
  const sampleCatalog = [
    {
      id: { provider: 'moviebox', value: 'demo-dune-part-two' },
      title: 'Dune: Part Two',
      year: '2024',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',
      imdb_rating: '8.5',
      duration: '166m',
      genres: ['Science Fiction', 'Adventure', 'Drama'],
      director: 'Denis Villeneuve',
      cast: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Javier Bardem'],
      tagline: 'Long live the fighters.',
      description: 'Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a path of revenge against the conspirators who destroyed his family.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-interstellar' },
      title: 'Interstellar',
      year: '2014',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
      imdb_rating: '8.7',
      duration: '169m',
      genres: ['Adventure', 'Drama', 'Science Fiction'],
      director: 'Christopher Nolan',
      cast: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine'],
      tagline: 'Mankind was born on Earth. It was never meant to die here.',
      description: 'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel and conquer the vast distances involved in an interstellar voyage.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-oppenheimer' },
      title: 'Oppenheimer',
      year: '2023',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',
      imdb_rating: '8.3',
      duration: '181m',
      genres: ['Drama', 'History', 'Thriller'],
      director: 'Christopher Nolan',
      cast: ['Cillian Murphy', 'Emily Blunt', 'Matt Damon', 'Robert Downey Jr.'],
      tagline: 'The world forever changes.',
      description: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-spirited-away' },
      title: 'Spirited Away',
      year: '2001',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/bSXfU4dwZyBA1vMmXvejdRXBvuF.jpg',
      imdb_rating: '8.6',
      duration: '125m',
      genres: ['Animation', 'Adventure', 'Fantasy'],
      director: 'Hayao Miyazaki',
      cast: ['Rumi Hiiragi', 'Miyu Irino', 'Mari Natsuki'],
      tagline: 'Nothing that happens is ever forgotten, even if you can’t remember it.',
      description: 'A young girl, Chihiro, becomes trapped in a strange new world of spirits. When her parents undergo a mysterious transformation, she must call upon the courage she never knew she had to free her family.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-the-batman' },
      title: 'The Batman',
      year: '2022',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg',
      imdb_rating: '7.8',
      duration: '176m',
      genres: ['Crime', 'Mystery', 'Thriller', 'Action'],
      director: 'Matt Reeves',
      cast: ['Robert Pattinson', 'Zoë Kravitz', 'Paul Dano', 'Jeffrey Wright'],
      tagline: 'Unmask the truth.',
      description: 'In his second year of fighting crime, Batman uncovers corruption in Gotham City that connects to his own family while facing a serial killer known as the Riddler.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-blade-runner-2049' },
      title: 'Blade Runner 2049',
      year: '2017',
      media_type: 'movie',
      poster_url: 'https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/ilRyazdMJwN05exqhwK4tMKBYZs.jpg',
      imdb_rating: '8.0',
      duration: '164m',
      genres: ['Science Fiction', 'Drama', 'Mystery'],
      director: 'Denis Villeneuve',
      cast: ['Ryan Gosling', 'Harrison Ford', 'Ana de Armas'],
      tagline: 'The key to the future is finally unearthed.',
      description: 'Thirty years after the events of the first film, a new blade runner, LAPD Officer K, unearths a long-buried secret that has the potential to plunge what’s left of society into chaos.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-severance' },
      title: 'Severance',
      year: '2022',
      media_type: 'series',
      season_count: 2,
      poster_url: 'https://image.tmdb.org/t/p/w500/lFf6LLrQjYldcZItzOkGmMMigP7.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/ixgFmf1X59PUZam2qbAfskx2gQr.jpg',
      imdb_rating: '8.7',
      duration: '50m',
      genres: ['Drama', 'Mystery', 'Science Fiction', 'Thriller'],
      director: 'Ben Stiller',
      cast: ['Adam Scott', 'Britt Lower', 'Zach Cherry', 'John Turturro'],
      tagline: 'Please try to enjoy each episode equally.',
      description: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to discover the truth about their jobs.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-shogun' },
      title: 'Shōgun',
      year: '2024',
      media_type: 'series',
      season_count: 1,
      poster_url: 'https://image.tmdb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/5zmiBoMzeeVdQ62no55JOJMY498.jpg',
      imdb_rating: '8.6',
      duration: '60m',
      genres: ['Drama', 'Action', 'Adventure', 'History'],
      director: 'Rachel Kondo',
      cast: ['Hiroyuki Sanada', 'Cosmo Jarvis', 'Anna Sawai'],
      tagline: 'An epic saga of war, passion, and power in feudal Japan.',
      description: 'In Japan in the year 1600, at the dawn of a century-defining civil war, Lord Yoshii Toranaga is fighting for his life as his enemies on the Council of Regents unite against him.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-arcane' },
      title: 'Arcane',
      year: '2021',
      media_type: 'series',
      season_count: 2,
      poster_url: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg',
      imdb_rating: '9.0',
      duration: '42m',
      genres: ['Animation', 'Action', 'Adventure', 'Science Fiction'],
      director: 'Christian Linke',
      cast: ['Hailee Steinfeld', 'Ella Purnell', 'Kevin Alejandro'],
      tagline: 'Every legend has a beginning.',
      description: 'Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies and clashing convictions.',
    },
    {
      id: { provider: 'moviebox', value: 'demo-the-bear' },
      title: 'The Bear',
      year: '2022',
      media_type: 'series',
      season_count: 3,
      poster_url: 'https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg',
      backdrop_url: 'https://image.tmdb.org/t/p/w1280/zPyj6L5xH3mD1b4jBfB4kQ2f5x2.jpg',
      imdb_rating: '8.5',
      duration: '34m',
      genres: ['Drama', 'Comedy'],
      director: 'Christopher Storer',
      cast: ['Jeremy Allen White', 'Ayo Edebiri', 'Ebon Moss-Bachrach'],
      tagline: 'Every second counts.',
      description: 'A young chef from the fine dining world comes home to Chicago to run his family sandwich shop after a heartbreaking loss.',
    },
  ];

  const knownProviders = new Set([
    'moviebox',
    'fourkhdhub',
    'dramachi',
    'bdix_circleftp',
    'bdix_dhakaflix',
    'addons',
  ]);
  const library = { version: 1, watchlist: [], progress: [], ratings: [] };

  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  };

  const readJson = (req) =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
      });
    });

  return {
    name: 'ifallhub-demo-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        if (path === '/api/health') {
          return send(res, 200, { status: 'ok', ok: true, mode: 'demo', service: 'ifallhub-demo-api', version: 'demo', auth_required: false });
        }
        if (path === '/api/providers') {
          return send(res, 200, [
            { id: 'moviebox', name: 'Siddharth', label: 'Siddharth', supports_discover: true },
            { id: 'fourkhdhub', name: 'Ritu', label: 'Ritu', supports_discover: false },
            { id: 'dramachi', name: 'Sakshi', label: 'Sakshi', supports_discover: false },
            { id: 'bdix_circleftp', name: 'Shreya', label: 'Shreya', supports_discover: false },
            { id: 'bdix_dhakaflix', name: 'Everyone', label: 'Everyone', supports_discover: false },
            { id: 'addons', name: 'Ifallhub', label: 'Ifallhub', supports_discover: false },
          ]);
        }
        if (path.startsWith('/api/media/')) {
          return send(res, 404, { error: 'Unknown or expired media session' });
        }
        if (path === '/api/discover') {
          const metrics = Object.fromEntries(
            sampleCatalog.map((item, idx) => [
              item.id.value,
              {
                trending: 100 - idx * 7,
                rating: Number(item.imdb_rating) * 10,
                recent_rating: Number(item.year) >= 2022 ? Number(item.imdb_rating) * 10 : 50,
                popularity: 95 - idx * 5,
              },
            ]),
          );
          return send(res, 200, { items: sampleCatalog, metrics });
        }
        if (path === '/api/collections') {
          return send(res, 200, {
            source: 'moviebox',
            metrics: {},
            rows: [
              { key: 'trending', label: 'Trending Now', hint: 'What everyone is watching this week', items: sampleCatalog },
              {
                key: 'top_rated',
                label: 'Top Rated',
                hint: 'Highest IMDb scores of all time',
                items: [...sampleCatalog].sort((a, b) => Number(b.imdb_rating) - Number(a.imdb_rating)),
              },
              {
                key: 'fresh',
                label: 'Fresh & Highly Rated',
                hint: 'Recent releases critics liked',
                items: sampleCatalog.filter((it) => Number(it.year) >= 2022),
              },
              {
                key: 'most_watched',
                label: 'Most Watched',
                hint: 'Community favourites',
                items: [...sampleCatalog].reverse(),
              },
            ],
          });
        }
        if (path === '/api/search') {
          const q = (url.searchParams.get('q') || '').toLowerCase();
          const provider = url.searchParams.get('provider') || 'moviebox';
          const matches = sampleCatalog
            .filter((it) =>
              it.title.toLowerCase().includes(q) ||
              (it.genres || []).some((g) => g.toLowerCase().includes(q)) ||
              String(it.director || '').toLowerCase().includes(q) ||
              String(it.year || '').includes(q),
            )
            .map((it) => ({ ...it, id: { provider, value: it.id.value } }));
          return send(res, 200, matches.length ? matches : sampleCatalog.slice(0, 4).map((it) => ({ ...it, id: { provider, value: it.id.value } })));
        }
        if (path === '/api/suggest') {
          const q = (url.searchParams.get('q') || '').toLowerCase();
          return send(res, 200, {
            suggestions: sampleCatalog.map((it) => it.title).filter((t) => t.toLowerCase().includes(q)).slice(0, 6),
          });
        }
        if (path === '/api/details') {
          const id = url.searchParams.get('id') || sampleCatalog[0].id.value;
          const provider = url.searchParams.get('provider') || 'moviebox';
          const found = sampleCatalog.find((it) => it.id.value === id) || sampleCatalog[0];
          const seasonTotal = found.season_count || 2;
          const seasons = found.media_type === 'series'
            ? Array.from({ length: seasonTotal }, (_, sIdx) => ({
                season_number: sIdx + 1,
                episode_count: 8,
                episodes: Array.from({ length: 8 }, (__, eIdx) => ({
                  episode_number: eIdx + 1,
                  title: `Chapter ${eIdx + 1}`,
                  duration: found.duration || '48m',
                  overview: `Season ${sIdx + 1}, Episode ${eIdx + 1} of ${found.title}.`,
                })),
              }))
            : [];
          return send(res, 200, {
            ...found,
            id: { provider, value: found.id.value },
            prints: ['2160p', '1080p', '720p'],
            audios: ['English', 'Hindi'],
            seasons,
          });
        }
        if (path === '/api/related') {
          const id = (url.searchParams.get('id') || '').trim();
          if (!id) return send(res, 400, { error: 'Missing required id parameter' });
          const others = sampleCatalog.filter((it) => it.id.value !== id);
          return send(res, 200, {
            items: others,
            reasons: Object.fromEntries(others.map((it) => [it.id.value, [`Because you like ${(it.genres || ['Cinema'])[0]}`]])),
            seeds: [{ term: 'Sci-Fi', reason: 'Because you like Science Fiction' }],
            source_id: id,
          });
        }
        if (path === '/api/meta') {
          const ids = (url.searchParams.get('id') || '').split(',').map((s) => s.trim()).filter(Boolean);
          const meta = {};
          for (const id of ids) {
            const it = sampleCatalog.find((entry) => entry.id.value === id);
            if (it) {
              meta[id] = {
                imdb_rating: it.imdb_rating,
                genres: it.genres,
                duration: it.duration,
                year: it.year,
                poster_url: it.poster_url,
                media_type: it.media_type,
              };
            }
          }
          return send(res, 200, { meta });
        }
        if (path === '/api/streams') {
          const id = url.searchParams.get('id') || sampleCatalog[0].id.value;
          const provider = url.searchParams.get('provider') || 'moviebox';
          const found = sampleCatalog.find((it) => it.id.value === id) || sampleCatalog[0];
          const epTag = Number(url.searchParams.get('season')) > 0
            ? `.S0${url.searchParams.get('season')}E0${url.searchParams.get('episode') || 1}`
            : `.${found.year}`;
          const slug = found.title.replace(/[^a-zA-Z0-9]+/g, '.');
          return send(res, 200, {
            stream_set_id: 'demo-set',
            releases: [
              {
                provider,
                filename: `${slug}${epTag}.1080p.WEB-DL.AAC2.0.H.264.mp4`,
                quality: '1080p',
                codec: 'h264',
                size_bytes: 1_850_000_000,
                mirrors: [
                  { label: 'Primary CDN (1080p)', direct_file: true },
                  { label: 'Backup CDN (1080p)', direct_file: true },
                ],
              },
              {
                provider,
                filename: `${slug}${epTag}.2160p.UHD.DV.HDR10.DDP5.1.H.265.mkv`,
                quality: '2160p',
                codec: 'h265',
                size_bytes: 5_400_000_000,
                mirrors: [{ label: '4K Remux Mirror', direct_file: true }],
              },
              {
                provider,
                filename: `${slug}${epTag}.720p.WEBRip.AAC.x264.mp4`,
                quality: '720p',
                codec: 'h264',
                size_bytes: 920_000_000,
                mirrors: [{ label: 'Fast 720p Mirror', direct_file: true }],
              },
            ],
          });
        }
        if (path === '/api/play') {
          return send(res, 200, {
            url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            playback_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            stream_type: 'file',
            content_type: 'video/mp4',
            direct_file: true,
          });
        }
        if (path === '/api/player') {
          return send(res, 200, {
            available: false,
            players: [],
            reason: 'Running in browser demo mode — use VLC app link, .m3u playlist, or Copy link below.',
          });
        }
        if (path === '/api/subtitles') {
          return send(res, 200, {
            subtitle_set_id: 'demo-subs',
            subtitles: [
              { index: 0, name: 'English · Official WEB-DL', language: 'en', format: 'vtt', provider: 'moviebox' },
              { index: 1, name: 'English [SDH] · OpenSubtitles', language: 'en', format: 'srt', provider: 'opensubtitles' },
              { index: 2, name: 'Hindi · Wyzie', language: 'hi', format: 'vtt', provider: 'wyzie' },
            ],
          });
        }
        if (path === '/api/subtitle-file') {
          return send(res, 200, {
            name: 'English · Official WEB-DL',
            format: 'vtt',
            text: 'WEBVTT\n\n00:00:00.500 --> 00:00:05.000\nSubtitles connected via Ifallhub Subtitle Engine.\n\n00:00:05.500 --> 00:00:12.000\nEnjoy watching in browser or external VLC / mpv.\n',
          });
        }
        if (path === '/api/library' && req.method === 'GET') {
          return send(res, 200, { ...library, stats: {} });
        }
        if (path === '/api/library/events') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.write(`event: library\ndata: ${JSON.stringify(library)}\n\n`);
          return;
        }
        if (path === '/api/library/watchlist' && req.method === 'POST') {
          const body = await readJson(req);
          if (!knownProviders.has(String(body.provider || '').toLowerCase()) || !body.id) {
            return send(res, 400, { error: 'Invalid provider or title id' });
          }
          const idx = library.watchlist.findIndex((e) => e.provider === body.provider && e.id === body.id);
          let listed = false;
          if (body.remove === true) {
            if (idx >= 0) library.watchlist.splice(idx, 1);
          } else if (idx >= 0 && body.remove === undefined) {
            library.watchlist.splice(idx, 1);
          } else if (idx < 0) {
            library.watchlist.unshift({ ...body, added_at: Math.floor(Date.now() / 1000) });
            listed = true;
          } else {
            listed = true;
          }
          library.version += 1;
          return send(res, 200, { ...library, listed });
        }
        if (path === '/api/library/progress' && req.method === 'POST') {
          const body = await readJson(req);
          if (!knownProviders.has(String(body.provider || '').toLowerCase()) || !body.id) {
            return send(res, 400, { error: 'Invalid provider or title id' });
          }
          const idx = library.progress.findIndex((e) => e.provider === body.provider && e.id === body.id);
          if (body.remove) {
            if (idx >= 0) library.progress.splice(idx, 1);
          } else {
            const entry = { ...body, updated_at: Math.floor(Date.now() / 1000) };
            if (idx >= 0) library.progress[idx] = entry;
            else library.progress.unshift(entry);
          }
          library.version += 1;
          return send(res, 200, { ...library, stored: !body.remove });
        }
        if (path === '/api/library/rating' && req.method === 'POST') {
          const body = await readJson(req);
          if (!knownProviders.has(String(body.provider || '').toLowerCase()) || !body.id) {
            return send(res, 400, { error: 'Invalid provider or title id' });
          }
          const idx = library.ratings.findIndex((e) => e.provider === body.provider && e.id === body.id);
          if (!body.rating || body.rating <= 0) {
            if (idx >= 0) library.ratings.splice(idx, 1);
          } else {
            const entry = { ...body, updated_at: Math.floor(Date.now() / 1000) };
            if (idx >= 0) library.ratings[idx] = entry;
            else library.ratings.unshift(entry);
          }
          library.version += 1;
          return send(res, 200, { ...library, rated: body.rating > 0 ? body.rating : null });
        }
        if (path === '/api/library/clear' && req.method === 'POST') {
          const body = await readJson(req);
          const scope = body.scope || 'all';
          if (scope === 'watchlist' || scope === 'all') library.watchlist = [];
          if (scope === 'progress' || scope === 'all') library.progress = [];
          if (scope === 'ratings' || scope === 'all') library.ratings = [];
          library.version += 1;
          return send(res, 200, { ...library, cleared: scope });
        }
        return next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.MOVIEBOX_API_TARGET || 'http://127.0.0.1:8787';
  const useDemo = mode === 'demo';

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      tailwindcss(),
      ...(useDemo ? [makeMockApiPlugin()] : []),
    ],
    server: {
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      proxy: useDemo
        ? undefined
        : {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
            },
          },
    },
    preview: {
      port: 4173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2022',
    },
  };
});
