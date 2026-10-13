import { defineConfig, loadEnv } from 'vite';

// ---------------------------------------------------------------------------
// Demo data. Only used when no API URL is configured, so `npm run dev` renders
// the full UI offline. Production builds ship no API of their own.
// ---------------------------------------------------------------------------

const demoTitles = [
  {
    id: { provider: 'moviebox', value: 'demo-interstellar' },
    title: 'Interstellar',
    media_type: 'movie',
    year: '2014',
    poster_url: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    season_count: null,
    description:
      'A team of explorers travels beyond this galaxy to discover whether mankind has a future among the stars.',
    rating: '8.7',
    director: 'Christopher Nolan',
    stars: 'Matthew McConaughey, Anne Hathaway, Jessica Chastain',
    duration: '169m',
    genres: ['Adventure', 'Drama', 'Science Fiction'],
    trending: 980,
    popularity: 940,
    recent_rating: 8.4,
  },
  {
    id: { provider: 'moviebox', value: 'demo-dune-two' },
    title: 'Dune: Part Two',
    media_type: 'movie',
    year: '2024',
    poster_url: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    season_count: null,
    description:
      'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    rating: '8.5',
    director: 'Denis Villeneuve',
    stars: 'Timothée Chalamet, Zendaya, Rebecca Ferguson',
    duration: '166m',
    genres: ['Adventure', 'Science Fiction'],
    trending: 970,
    popularity: 900,
    recent_rating: 8.6,
  },
  {
    id: { provider: 'moviebox', value: 'demo-batman' },
    title: 'The Batman',
    media_type: 'movie',
    year: '2022',
    poster_url: 'https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg',
    season_count: null,
    description:
      'Batman ventures into Gotham City’s underworld when a sadistic killer leaves behind a trail of cryptic clues.',
    rating: '7.8',
    director: 'Matt Reeves',
    stars: 'Robert Pattinson, Zoë Kravitz, Paul Dano',
    duration: '176m',
    genres: ['Crime', 'Mystery', 'Drama'],
    trending: 830,
    popularity: 880,
    recent_rating: 7.6,
  },
  {
    id: { provider: 'moviebox', value: 'demo-poor-things' },
    title: 'Poor Things',
    media_type: 'movie',
    year: '2023',
    poster_url: 'https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg',
    season_count: null,
    description:
      'The incredible tale and fantastical evolution of Bella Baxter, a young woman brought back to life by an unorthodox scientist.',
    rating: '7.8',
    director: 'Yorgos Lanthimos',
    stars: 'Emma Stone, Mark Ruffalo, Willem Dafoe',
    duration: '141m',
    genres: ['Science Fiction', 'Romance', 'Comedy'],
    trending: 760,
    popularity: 720,
    recent_rating: 7.9,
  },
  {
    id: { provider: 'moviebox', value: 'demo-past-lives' },
    title: 'Past Lives',
    media_type: 'movie',
    year: '2023',
    poster_url: 'https://image.tmdb.org/t/p/w500/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
    season_count: null,
    description:
      'Two deeply connected childhood friends are wrested apart after one family emigrates from South Korea.',
    rating: '7.8',
    director: 'Celine Song',
    stars: 'Greta Lee, Teo Yoo, John Magaro',
    duration: '105m',
    genres: ['Drama', 'Romance'],
    trending: 690,
    popularity: 610,
    recent_rating: 8.1,
  },
  {
    id: { provider: 'moviebox', value: 'demo-wild-robot' },
    title: 'The Wild Robot',
    media_type: 'movie',
    year: '2024',
    poster_url: 'https://image.tmdb.org/t/p/w500/wTnV3PCVW5O92JMrFvvrRcV39RU.jpg',
    season_count: null,
    description:
      'A robot finds herself on an uninhabited island and builds an unexpected bond with the animals around her.',
    rating: '8.2',
    director: 'Chris Sanders',
    stars: 'Lupita Nyong’o, Pedro Pascal, Kit Connor',
    duration: '102m',
    genres: ['Animation', 'Family', 'Adventure'],
    trending: 880,
    popularity: 800,
    recent_rating: 8.3,
  },
  {
    id: { provider: 'moviebox', value: 'demo-oppenheimer' },
    title: 'Oppenheimer',
    media_type: 'movie',
    year: '2023',
    poster_url: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    season_count: null,
    description: 'The story of the American physicist who led the development of the atomic bomb.',
    rating: '8.3',
    director: 'Christopher Nolan',
    stars: 'Cillian Murphy, Emily Blunt, Robert Downey Jr.',
    duration: '180m',
    genres: ['Drama', 'History'],
    trending: 905,
    popularity: 950,
    recent_rating: 8.0,
  },
  {
    id: { provider: 'moviebox', value: 'demo-arcane' },
    title: 'Arcane',
    media_type: 'series',
    year: '2021',
    poster_url: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg',
    season_count: 2,
    description:
      'Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival sides of a war between magic technologies and clashing convictions.',
    rating: '9.0',
    director: 'Pascal Charrue',
    stars: 'Hailee Steinfeld, Ella Purnell, Kevin Alejandro',
    duration: '40m',
    genres: ['Animation', 'Action', 'Adventure'],
    trending: 940,
    popularity: 910,
    recent_rating: 8.9,
    seasons: [
      {
        number: 1,
        episodes: [
          { season: 1, number: 1, title: 'Welcome to the Playground', overview: 'Vi and Powder sneak into Piltover.' },
          { season: 1, number: 2, title: 'Some Mysteries Are Better Left Unsolved', overview: null },
          { season: 1, number: 3, title: 'The Base Violence Necessary for Change', overview: null },
        ],
      },
      { number: 2, episodes: [{ season: 2, number: 1, title: 'Heavy Is the Crown', overview: null }] },
    ],
  },
  {
    id: { provider: 'moviebox', value: 'demo-shogun' },
    title: 'Shōgun',
    media_type: 'series',
    year: '2024',
    poster_url: 'https://image.tmdb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
    season_count: 1,
    description:
      'In Japan in the year 1600, a mysterious European ship pilot becomes a pawn in a political struggle.',
    rating: '8.6',
    director: 'Rachel Kondo',
    stars: 'Hiroyuki Sanada, Cosmo Jarvis, Anna Sawai',
    duration: '55m',
    genres: ['Drama', 'History', 'War'],
    trending: 920,
    popularity: 870,
    recent_rating: 8.7,
    seasons: [
      {
        number: 1,
        episodes: [
          { season: 1, number: 1, title: 'Anjin', overview: 'A ship runs aground in Japan.' },
          { season: 1, number: 2, title: 'Servants of Two Masters', overview: null },
        ],
      },
    ],
  },
];

const providers = [
  { id: 'moviebox', name: 'MovieBox' },
  { id: 'fourkhdhub', name: '4KHDHub' },
  { id: 'dramachi', name: 'Dramachi' },
  { id: 'bdix_circleftp', name: 'CircleFTP (BDIX)' },
  { id: 'bdix_dhakaflix', name: 'DhakaFlix (BDIX)' },
  { id: 'addons', name: 'Community Add-ons' },
];

const sampleVideo = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

const COLLECTION_ROWS = [
  { key: 'trending', label: 'Trending Now', hint: 'What everyone is watching this week', metric: 'trending' },
  { key: 'top_rated', label: 'Top Rated', hint: 'Highest IMDb scores of all time', metric: 'rating' },
  { key: 'fresh', label: 'Fresh & Highly Rated', hint: 'Recent releases critics liked', metric: 'recent_rating' },
  { key: 'most_watched', label: 'Most Watched', hint: 'Community favourites', metric: 'popularity' },
];

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function catalogShape(item) {
  return {
    id: item.id,
    title: item.title,
    media_type: item.media_type,
    year: item.year,
    poster_url: item.poster_url,
    season_count: item.season_count ?? null,
  };
}

function metricsShape(item) {
  return {
    trending: item.trending ?? null,
    rating: Number(item.rating) || null,
    recent_rating: item.recent_rating ?? null,
    popularity: item.popularity ?? null,
  };
}

function makeMockApiPlugin(enabled) {
  return {
    name: 'ifallhub-demo-api',
    configureServer(server) {
      if (!enabled) return;

      // In-memory library so the demo behaves like the Rust engine, including
      // the SSE stream that keeps browsers in sync.
      const libraryState = { watchlist: [], progress: [], ratings: [], version: 0 };
      const subscribers = new Set();

      const broadcast = () => {
        const payload = JSON.stringify({ ...libraryState, synced_at: Math.floor(Date.now() / 1000) });
        for (const res of subscribers) {
          res.write(`event: library\ndata: ${payload}\n\n`);
        }
      };
      const touch = (scope) => {
        libraryState.version += 1;
        server.config.logger.info(`demo library: ${scope} (v${libraryState.version})`);
        broadcast();
      };
      const keyOf = (entry) => `${String(entry.provider).toLowerCase()}::${entry.id}`;

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const query = url.searchParams;
        const path = url.pathname;
        const itemId = query.get('id') || '';
        const item = demoTitles.find((entry) => entry.id.value === itemId) || demoTitles[0];
        const isSeries = item.media_type === 'series';

        const readBody = () =>
          new Promise((resolve) => {
            let raw = '';
            req.on('data', (chunk) => {
              raw += chunk;
            });
            req.on('end', () => {
              try {
                resolve(raw ? JSON.parse(raw) : {});
              } catch {
                resolve({});
              }
            });
          });

        if (path === '/api/health') {
          return json(res, 200, {
            status: 'ok',
            mode: 'demo',
            engine: 'Ifallhub web preview',
            version: '0.0.0-demo',
          });
        }

        if (path === '/api/providers') return json(res, 200, providers);

        if (path === '/api/collections') {
          const limit = Math.min(Number(query.get('limit')) || 24, 48);
          const metrics = {};
          const rows = COLLECTION_ROWS.map((row) => {
            const items = [...demoTitles]
              .sort((a, b) => (b[row.metric] || 0) - (a[row.metric] || 0))
              .slice(0, limit);
            for (const entry of items) metrics[entry.id.value] = metricsShape(entry);
            return { key: row.key, label: row.label, hint: row.hint, items: items.map(catalogShape) };
          });
          return json(res, 200, { rows, metrics, source: 'moviebox' });
        }

        if (path === '/api/discover') {
          const metrics = {};
          for (const entry of demoTitles) metrics[entry.id.value] = metricsShape(entry);
          return json(res, 200, { items: demoTitles.map(catalogShape), metrics });
        }

        if (path === '/api/search') {
          const term = (query.get('q') || '').trim().toLowerCase();
          const matches = demoTitles.filter((entry) => {
            const text = `${entry.title} ${entry.year} ${entry.genres.join(' ')} ${entry.director} ${entry.stars}`.toLowerCase();
            return !term || text.includes(term);
          });
          return json(res, 200, matches.map(catalogShape));
        }

        if (path === '/api/suggest') {
          const term = (query.get('q') || '').trim().toLowerCase();
          const suggestions = term
            ? demoTitles.map((entry) => entry.title).filter((title) => title.toLowerCase().includes(term))
            : [];
          return json(res, 200, { suggestions: suggestions.slice(0, 8) });
        }

        if (path === '/api/details') {
          return json(res, 200, {
            id: item.id,
            title: item.title,
            media_type: item.media_type,
            year: item.year,
            description: item.description,
            tagline: null,
            imdb_rating: item.rating,
            director: item.director,
            stars: item.stars,
            prints: '1080p · WEB-DL',
            audios: 'English',
            poster_url: item.poster_url,
            duration: item.duration,
            genres: item.genres,
            seasons: item.seasons || [],
            dubs: [],
          });
        }

        if (path === '/api/related') {
          if (!itemId) return json(res, 400, { error: 'A valid title id is required' });
          const shared = item.genres || [];
          const matches = demoTitles.filter((entry) => {
            if (entry.id.value === item.id.value) return false;
            const overlap = (entry.genres || []).some((genre) => shared.includes(genre));
            return overlap || entry.director === item.director;
          });
          const reasons = {};
          for (const entry of matches) {
            const genre = (entry.genres || []).find((candidate) => shared.includes(candidate));
            reasons[entry.id.value] = [
              genre ? `Because you like ${genre}` : `More from ${item.director}`,
            ];
          }
          return json(res, 200, {
            items: matches.map(catalogShape),
            reasons,
            seeds: shared.map((genre) => ({ term: genre, reason: `Because you like ${genre}` })),
            source_id: item.id.value,
          });
        }

        if (path === '/api/meta') {
          const ids = (query.get('id') || '').split(',').filter(Boolean);
          const meta = {};
          for (const id of ids) {
            const entry = demoTitles.find((candidate) => candidate.id.value === id);
            if (!entry) continue;
            meta[id] = { rating: Number(entry.rating) || null, genres: entry.genres, duration: entry.duration };
          }
          return json(res, 200, { meta });
        }

        if (path === '/api/subtitles') {
          return json(res, 200, { subtitle_set_id: null, subtitles: [] });
        }

        if (path === '/api/subtitle-file') {
          return json(res, 404, { error: 'Demo mode has no external subtitle files' });
        }

        if (path === '/api/streams') {
          return json(res, 200, {
            stream_set_id: `demo-stream-${item.id.value}`,
            blocked_addons: [],
            releases: [
              {
                provider: query.get('provider') || 'moviebox',
                filename: `${item.title.replaceAll(' ', '.')}.${item.year}.1080p.Demo.mp4`,
                quality: '1080p',
                codec: 'H.264',
                language: 'English',
                size_bytes: 1640000000,
                season: isSeries ? Number(query.get('season')) || 1 : null,
                episode: isSeries ? Number(query.get('episode')) || 1 : null,
                mirrors: [{ label: 'Sample video', resolver_url: '', headers: [], direct_file: true }],
                resource_id: null,
              },
              {
                provider: query.get('provider') || 'moviebox',
                filename: `${item.title.replaceAll(' ', '.')}.${item.year}.720p.Demo.mp4`,
                quality: '720p',
                codec: 'H.264',
                language: 'English',
                size_bytes: 940000000,
                season: null,
                episode: null,
                mirrors: [{ label: 'Sample video', resolver_url: '', headers: [], direct_file: true }],
                resource_id: null,
              },
            ],
          });
        }

        if (path === '/api/play' && req.method === 'POST') {
          await readBody();
          return json(res, 200, {
            playback_url: sampleVideo,
            stream_type: 'file',
            source_label: 'Demo sample',
            quality: '1080p',
            mode: 'demo',
          });
        }

        // --- Library -------------------------------------------------------
        if (path === '/api/library' && req.method !== 'POST') {
          return json(res, 200, { ...libraryState, synced_at: Math.floor(Date.now() / 1000) });
        }

        if (path.startsWith('/api/library/') && req.method === 'POST') {
          const body = await readBody();
          const known = providers.some((entry) => entry.id === String(body.provider || '').toLowerCase());
          if (path !== '/api/library/clear' && !known) {
            return json(res, 400, { error: 'Unknown content provider' });
          }
          if (path !== '/api/library/clear' && !String(body.id || '').trim()) {
            return json(res, 400, { error: 'A valid title id is required' });
          }
          req.demoLibraryBody = body;
        }

        if (path === '/api/library/watchlist' && req.method === 'POST') {
          const body = req.demoLibraryBody || (await readBody());
          const key = keyOf(body);
          const stamp = Math.floor(Date.now() / 1000);
          if (body.remove) {
            libraryState.watchlist = libraryState.watchlist.filter((entry) => keyOf(entry) !== key);
          } else {
            const existing = libraryState.watchlist.find((entry) => keyOf(entry) === key);
            const entry = { added_at: stamp, ...body, updated_at: stamp, added_at: existing?.added_at || stamp };
            if (existing) Object.assign(existing, entry);
            else libraryState.watchlist.unshift(entry);
          }
          touch('watchlist');
          return json(res, 200, { ...libraryState, listed: !body.remove, synced_at: stamp });
        }

        if (path === '/api/library/progress' && req.method === 'POST') {
          const body = req.demoLibraryBody || (await readBody());
          const key = keyOf(body);
          const stamp = Math.floor(Date.now() / 1000);
          if (body.remove) {
            libraryState.progress = libraryState.progress.filter((entry) => keyOf(entry) !== key);
          } else {
            const existing = libraryState.progress.find((entry) => keyOf(entry) === key);
            const entry = { ...body, updated_at: stamp };
            if (existing) Object.assign(existing, entry);
            else libraryState.progress.unshift(entry);
          }
          touch('progress');
          return json(res, 200, { ...libraryState, synced_at: stamp });
        }

        if (path === '/api/library/rating' && req.method === 'POST') {
          const body = req.demoLibraryBody || (await readBody());
          const key = keyOf(body);
          const stamp = Math.floor(Date.now() / 1000);
          const value = Math.max(0, Math.min(10, Number(body.rating) || 0));
          libraryState.ratings = libraryState.ratings.filter((entry) => keyOf(entry) !== key);
          if (value > 0) libraryState.ratings.unshift({ ...body, rating: value, updated_at: stamp });
          touch('ratings');
          return json(res, 200, { ...libraryState, rated: value > 0, synced_at: stamp });
        }

        if (path === '/api/library/clear' && req.method === 'POST') {
          const body = req.demoLibraryBody || (await readBody());
          const scope = String(body.scope || 'all');
          if (scope === 'all' || scope === 'watchlist') libraryState.watchlist = [];
          if (scope === 'all' || scope === 'progress') libraryState.progress = [];
          if (scope === 'all' || scope === 'ratings') libraryState.ratings = [];
          touch('clear');
          return json(res, 200, { ...libraryState, cleared: scope, synced_at: Math.floor(Date.now() / 1000) });
        }

        if (path === '/api/library/events') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();
          res.write(`event: library\ndata: ${JSON.stringify({ ...libraryState, synced_at: Math.floor(Date.now() / 1000) })}\n\n`);
          subscribers.add(res);
          const keepAlive = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 20000);
          req.on('close', () => {
            clearInterval(keepAlive);
            subscribers.delete(res);
          });
          return undefined;
        }

        return json(res, 404, { error: 'Unknown demo API route' });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'MOVIEBOX_');
  const ifallhubEnv = loadEnv(mode, process.cwd(), 'IFALLHUB_');
  const apiTarget =
    ifallhubEnv.IFALLHUB_API_URL ||
    process.env.IFALLHUB_API_URL ||
    env.MOVIEBOX_API_URL ||
    process.env.MOVIEBOX_API_URL;
  return {
    plugins: [makeMockApiPlugin(!apiTarget)],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      ...(apiTarget ? { proxy: { '/api': { target: apiTarget, changeOrigin: true } } } : {}),
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
  };
});
