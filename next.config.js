/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@napi-rs/canvas': 'commonjs @napi-rs/canvas',
      });
    }

    return config;
  },
  async redirects() {
    return [
      {
        source: '/translate',
        destination: '/',
        permanent: false,
      },
      {
        source: '/translate-v2',
        destination: '/',
        permanent: false,
      },
      {
        source: '/translate-vercel',
        destination: '/',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
