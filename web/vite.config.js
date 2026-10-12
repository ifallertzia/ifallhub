import { defineConfig, loadEnv } from 'vite';

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
    genres: ['Adventure', 'Drama', 'Science Fiction'],
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
    genres: ['Adventure', 'Science Fiction'],
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
    genres: ['Crime', 'Mystery', 'Drama'],
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
    genres: ['Science Fiction', 'Romance', 'Comedy'],
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
    genres: ['Drama', 'Romance'],
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
    genres: ['Animation', 'Family', 'Adventure'],
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

const sampleVideo =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function makeMockApiPlugin(enabled) {
  return {
    name: 'moviebox-demo-api',
    configureServer(server) {
      if (!enabled) return;

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const query = url.searchParams;
        const itemId = query.get('id') || '';
        const item = demoTitles.find((entry) => entry.id.value === itemId) || demoTitles[0];

        if (url.pathname === '/api/health') {
          return json(res, 200, {
            status: 'ok',
            mode: 'demo',
            engine: 'MovieBox-Tui web preview',
          });
        }

        if (url.pathname === '/api/providers') {
          return json(res, 200, providers);
        }

        if (url.pathname === '/api/discover') {
          return json(res, 200, { items: demoTitles, metrics: {} });
        }

        if (url.pathname === '/api/search') {
          const term = (query.get('q') || '').trim().toLowerCase();
          const provider = query.get('provider') || 'moviebox';
          const matches = demoTitles.filter((entry) => {
            const text = `${entry.title} ${entry.year} ${entry.genres.join(' ')}`.toLowerCase();
            return (!term || text.includes(term)) && entry.id.provider === provider;
          });
          return json(res, 200, matches);
        }

        if (url.pathname === '/api/details') {
          return json(res, 200, {
            id: item.id,
            title: item.title,
            media_type: item.media_type,
            year: item.year,
            description: item.description,
            tagline: null,
            imdb_rating: item.rating,
            director: item.director,
            stars: null,
            prints: null,
            audios: null,
            poster_url: item.poster_url,
            duration: '2h 15m',
            genres: item.genres,
            seasons: [],
            dubs: [],
          });
        }

        if (url.pathname === '/api/streams') {
          return json(res, 200, {
            stream_set_id: 'demo-stream-set',
            blocked_addons: [],
            releases: [
              {
                provider: query.get('provider') || 'moviebox',
                filename: `${item.title.replaceAll(' ', '.')}.${item.year}.1080p.Demo.mp4`,
                quality: '1080p',
                codec: 'H.264',
                language: 'English',
                size_bytes: 1640000000,
                season: null,
                episode: null,
                mirrors: [
                  {
                    label: 'Sample video',
                    resolver_url: sampleVideo,
                    headers: [],
                    direct_file: true,
                  },
                ],
                resource_id: null,
              },
            ],
          });
        }

        if (url.pathname === '/api/play' && req.method === 'POST') {
          return json(res, 200, {
            playback_url: sampleVideo,
            stream_type: 'file',
            source_label: 'Demo sample',
            quality: '1080p',
            mode: 'demo',
          });
        }

        return json(res, 404, { error: 'Unknown demo API route' });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'MOVIEBOX_');
  const ifallhubEnv = loadEnv(mode, process.cwd(), 'IFALLHUB_');
  const apiTarget = ifallhubEnv.IFALLHUB_API_URL
    || process.env.IFALLHUB_API_URL
    || env.MOVIEBOX_API_URL
    || process.env.MOVIEBOX_API_URL;
  return {
    plugins: [makeMockApiPlugin(!apiTarget)],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      ...(apiTarget
        ? { proxy: { '/api': { target: apiTarget, changeOrigin: true } } }
        : {}),
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
