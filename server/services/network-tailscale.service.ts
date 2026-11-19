import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);

export interface TailscalePeer {
  id: string;
  hostname: string;
  dnsName: string;
  tailscaleIp: string | null;
  os: string;
  online: boolean;
}

export interface NetworkMeshStatus {
  port: number;
  lanUrls: string[];
  tailscale: {
    installed: boolean;
    running: boolean;
    selfIp: string | null;
    selfDnsName: string | null;
    serveUrl: string | null;
    peers: TailscalePeer[];
  };
  recommendedMobileUrl: string;
  qrDataUrl: string | null;
}

export function getLocalLanAddresses(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const addr of entries) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('100.')) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

export function parseTailscaleStatusJson(rawJson: string): {
  running: boolean;
  selfIp: string | null;
  selfDnsName: string | null;
  peers: TailscalePeer[];
} {
  const parsed = JSON.parse(rawJson) as {
    BackendState?: string;
    Self?: { DNSName?: string; TailscaleIPs?: string[] };
    Peer?: Record<string, { ID?: string; HostName?: string; DNSName?: string; TailscaleIPs?: string[]; OS?: string; Online?: boolean }>;
  };

  const selfIp = parsed.Self?.TailscaleIPs?.find((ip) => !ip.includes(':')) ?? null;
  const selfDnsName = parsed.Self?.DNSName ? parsed.Self.DNSName.replace(/\.$/, '') : null;
  const peers: TailscalePeer[] = Object.values(parsed.Peer ?? {}).map((p) => ({
    id: p.ID ?? p.HostName ?? 'peer',
    hostname: p.HostName ?? 'unknown',
    dnsName: (p.DNSName ?? '').replace(/\.$/, ''),
    tailscaleIp: p.TailscaleIPs?.find((ip) => !ip.includes(':')) ?? null,
    os: p.OS ?? 'unknown',
    online: Boolean(p.Online),
  }));

  return {
    running: parsed.BackendState === 'Running',
    selfIp,
    selfDnsName,
    peers,
  };
}

export async function getNetworkMeshStatus(port = Number(process.env.LLAMREI_PORT ?? 4321)): Promise<NetworkMeshStatus> {
  const lanIps = getLocalLanAddresses();
  const lanUrls = lanIps.map((ip) => `http://${ip}:${port}`);

  let installed = false;
  let running = false;
  let selfIp: string | null = null;
  let selfDnsName: string | null = null;
  let serveUrl: string | null = null;
  let peers: TailscalePeer[] = [];

  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 2500 });
    installed = true;
    const parsed = parseTailscaleStatusJson(stdout);
    running = parsed.running;
    selfIp = parsed.selfIp;
    selfDnsName = parsed.selfDnsName;
    peers = parsed.peers;

    if (running && selfDnsName) {
      try {
        const serveCheck = await execFileAsync('tailscale', ['serve', 'status'], { timeout: 1500 });
        if (serveCheck.stdout && serveCheck.stdout.includes(String(port))) {
          serveUrl = `https://${selfDnsName}`;
        }
      } catch {
        // Serve not active yet
      }
    }
  } catch {
    installed = false;
  }

  const uiPort = process.env.NODE_ENV === 'production' ? port : 5173;
  const primaryLan = lanIps[0] ? `http://${lanIps[0]}:${uiPort}` : `http://127.0.0.1:${uiPort}`;

  const recommendedMobileUrl =
    serveUrl ?? (selfIp ? `http://${selfIp}:${uiPort}` : primaryLan);

  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(recommendedMobileUrl, {
      margin: 1,
      width: 180,
      color: { dark: '#00d992', light: '#050507' },
    });
  } catch {
    qrDataUrl = null;
  }

  return {
    port,
    lanUrls,
    tailscale: { installed, running, selfIp, selfDnsName, serveUrl, peers },
    recommendedMobileUrl,
    qrDataUrl,
  };
}
