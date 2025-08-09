/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    // Force 'ws' to be ignored in all bundles; browser will use native WebSocket
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ws: false,
    }
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      ws: false,
    }
    return config
  },
}
