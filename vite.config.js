import { defineConfig } from 'vite';

// SomaFM serves browser User-Agents a 302 self-redirect (?_ic2=<ts>); player
// UAs get the stream directly. Identify as a player and follow any residual
// redirect inside the proxy so the client never sees a cross-origin bounce.
// Mirrors conf/nginx.conf in paulynomial-index (the production proxy).
// NOTE: '/stream-raw' must come before '/stream' — Vite picks the first
// matching prefix (unlike nginx's longest-prefix), and '/stream' would
// otherwise swallow '/stream-raw' requests.
// SomaFM also 403s requests whose Referer isn't an allowed site (localhost
// included), so drop it before forwarding.
const stripReferer = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('referer'));
};

const streamProxy = {
  '/stream-raw': {
    target: 'https://ice2.somafm.com',
    changeOrigin: true,
    followRedirects: true,
    headers: { 'User-Agent': 'entrainment/1.0 (+https://paulynomial.com)' },
    rewrite: (path) => '/defcon-128-mp3',
    // Mask the content type like production nginx does, so iOS Safari's
    // fetch() gets raw bytes instead of handing off to WebKit's media loader.
    configure: (proxy) => {
      stripReferer(proxy);
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.headers['content-type'] = 'application/octet-stream';
      });
    },
  },
  '/stream': {
    target: 'https://ice2.somafm.com',
    changeOrigin: true,
    followRedirects: true,
    headers: { 'User-Agent': 'entrainment/1.0 (+https://paulynomial.com)' },
    rewrite: (path) => '/defcon-128-mp3',
    configure: stripReferer,
  },
};

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';

  return {
    build: isLib
      ? {
          lib: {
            entry: 'lib/index.js',
            name: 'Entrainment',
            fileName: 'entrainment',
            formats: ['es'],
          },
          rollupOptions: {
            external: ['three'],
            output: {
              globals: { three: 'THREE' },
            },
          },
        }
      : {
          outDir: 'dist',
        },
    server: {
      open: true,
      proxy: streamProxy,
    },
    preview: {
      allowedHosts: true,
      proxy: streamProxy,
    },
  };
});
