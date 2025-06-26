import type { NextConfig } from 'next';

// Get the Codespaces URL if we're in a Codespaces environment
const getCodespacesUrl = (): string | null => {
  if (process.env.CODESPACES && process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  }
  return null;
};

const codespacesUrl = getCodespacesUrl();

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        '*.app.github.dev',
        '*.githubpreview.dev',
        '*.gitpod.io',
        '*.preview.app.github.dev',
        ...(codespacesUrl ? [codespacesUrl] : []),
      ],
    },
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
  // Handle Codespaces and other dev environments
  ...(codespacesUrl && {
    assetPrefix: `https://${codespacesUrl}`,
  }),
};

export default nextConfig;
