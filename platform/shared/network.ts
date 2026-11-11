import os from 'os';
import QRCode from 'qrcode';

export interface PlatformNetworkConfig {
  localIp: string;
  port: number;
  localUrl: string;
  controllerUrl: string;
  gameUrl: string;
  isHttps: boolean;
}

export function detectLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

export function buildNetworkConfig(port: number, appUrlEnv?: string): PlatformNetworkConfig {
  const localIp = detectLocalIp();
  const baseUrl = appUrlEnv ? appUrlEnv.replace(/\/$/, '') : `http://${localIp}:${port}`;
  const isHttps = baseUrl.startsWith('https://');
  return {
    localIp,
    port,
    localUrl: baseUrl,
    controllerUrl: `${baseUrl}/controller`,
    gameUrl: `${baseUrl}/game`,
    isHttps,
  };
}

export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 400,
    margin: 2,
    color: {
      dark: '#00f5d4',
      light: '#0a0d14',
    },
  });
}

export function generateReconnectToken(prefix = 'tok'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
