import { getDb } from '../db/connection.ts';
import { getSecret } from './secret.service.ts';
import { sseBus } from '../lib/sse.ts';

export interface MarketSessionInfo {
  id: 'sydney' | 'tokyo' | 'london' | 'new_york';
  name: string;
  timeZone: string;
  localTimeStr: string;
  wibHoursLabel: string;
  isOpen: boolean;
}

function getLocalHourMinuteInZone(now: Date, timeZone: string): { hour: number; minute: number; weekday: number; label: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(map.hour ?? 0) % 24,
    minute: Number(map.minute ?? 0),
    weekday: weekdayMap[map.weekday ?? 'Mon'] ?? 1,
    label: `${map.hour}:${map.minute}`,
  };
}

function getTimezoneOffsetMinutes(now: Date, timeZone: string): number {
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone }));
  return Math.round((tzDate.getTime() - utcDate.getTime()) / 60_000);
}

function formatWibSessionWindow(now: Date, timeZone: string, openHourLocal: number, closeHourLocal: number): string {
  const wibOffset = 420; // UTC+7
  const zoneOffset = getTimezoneOffsetMinutes(now, timeZone);
  const diffHours = (wibOffset - zoneOffset) / 60;
  const openWib = ((openHourLocal + diffHours) % 24 + 24) % 24;
  const closeWib = ((closeHourLocal + diffHours) % 24 + 24) % 24;
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 === 0.5 ? '30' : '00'}`;
  return `${fmt(openWib)}–${fmt(closeWib)} WIB`;
}

export function getWibMarketSessions(now = new Date()): {
  wibTime: string;
  wibDate: string;
  sessions: MarketSessionInfo[];
} {
  const wibTime = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  const wibDate = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);

  const specs: Array<{
    id: MarketSessionInfo['id'];
    name: string;
    timeZone: string;
    openHour: number;
    closeHour: number;
  }> = [
    { id: 'sydney', name: 'Sydney', timeZone: 'Australia/Sydney', openHour: 8, closeHour: 17 },
    { id: 'tokyo', name: 'Tokyo', timeZone: 'Asia/Tokyo', openHour: 9, closeHour: 18 },
    { id: 'london', name: 'London', timeZone: 'Europe/London', openHour: 8, closeHour: 17 },
    { id: 'new_york', name: 'New York', timeZone: 'America/New_York', openHour: 8, closeHour: 17 },
  ];

  const sessions: MarketSessionInfo[] = specs.map((s) => {
    const info = getLocalHourMinuteInZone(now, s.timeZone);
    const isWeekday = info.weekday >= 1 && info.weekday <= 5;
    const isOpen = isWeekday && info.hour >= s.openHour && info.hour < s.closeHour;
    return {
      id: s.id,
      name: s.name,
      timeZone: s.timeZone,
      localTimeStr: info.label,
      wibHoursLabel: formatWibSessionWindow(now, s.timeZone, s.openHour, s.closeHour),
      isOpen,
    };
  });

  return { wibTime, wibDate, sessions };
}

export function getMarketAndNewsFeed() {
  const db = getDb();
  const news = db.prepare('SELECT * FROM news_articles ORDER BY is_saved DESC, published_at DESC LIMIT 30').all();
  const economicEvents = db.prepare('SELECT * FROM economic_events ORDER BY scheduled_at ASC LIMIT 20').all();
  return { news, economicEvents };
}

export async function refreshLiveFinnhubAndRss(): Promise<{ addedNews: number; sourceNotes: string[] }> {
  const db = getDb();
  let addedNews = 0;
  const sourceNotes: string[] = [];

  const finnhubKey = getSecret('FINNHUB_API_KEY');
  if (finnhubKey) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/news?category=forex&token=${encodeURIComponent(finnhubKey)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const items = (await res.json()) as Array<{
          id: number;
          headline: string;
          url: string;
          source: string;
          summary: string;
          datetime: number;
        }>;
        const ins = db.prepare(
          `INSERT OR IGNORE INTO news_articles (id, source_name, category, title, url, published_at, summary_raw, ai_topics_json)
           VALUES (?, ?, 'forex', ?, ?, ?, ?, '["FOREX","MACRO"]')`,
        );
        for (const item of items.slice(0, 8)) {
          const info = ins.run(
            `fh_${item.id}`,
            item.source || 'Finnhub',
            item.headline,
            item.url,
            new Date(item.datetime * 1000).toISOString(),
            item.summary || '',
          );
          addedNews += Number(info.changes);
        }
        sourceNotes.push('Finnhub forex news refreshed');
      }
    } catch {
      sourceNotes.push('Finnhub request skipped/offline');
    }
  } else {
    sourceNotes.push('FINNHUB_API_KEY belum diatur (pakai cache lokal)');
  }

  // Public AI RSS feed (Simon Willison / HuggingFace blog lightweight XML parse)
  try {
    const rssRes = await fetch('https://huggingface.co/blog/feed.xml', { signal: AbortSignal.timeout(4500) });
    if (rssRes.ok) {
      const xml = await rssRes.text();
      const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO news_articles (id, source_name, category, title, url, published_at, summary_raw, ai_topics_json)
         VALUES (?, 'HuggingFace AI RSS', 'ai', ?, ?, ?, ?, '["AI","MODEL"]')`,
      );
      for (const m of itemMatches) {
        const block = m[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] ??
          block.match(/<title>(.*?)<\/title>/)?.[1] ??
          '').trim();
        const link = (block.match(/<link>(.*?)<\/link>/)?.[1] ?? '').trim();
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '').trim();
        if (title && link) {
          const info = ins.run(
            `rss_${Buffer.from(link).toString('base64').slice(0, 12)}`,
            title,
            link,
            pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            'Artikel riset & rilis AI dari HuggingFace RSS.',
          );
          addedNews += Number(info.changes);
        }
      }
      sourceNotes.push('AI RSS refreshed');
    }
  } catch {
    sourceNotes.push('AI RSS offline');
  }

  sseBus.emit('market:news_updated', { addedNews });
  return { addedNews, sourceNotes };
}

export async function syncNotionCalendarDatabase(): Promise<{ synced: number; note: string }> {
  const db = getDb();
  const notionToken = getSecret('NOTION_TOKEN');
  const dbIdSetting = db.prepare("SELECT value_json FROM app_settings WHERE key = 'notion_database_id'").get() as
    | { value_json: string }
    | undefined;
  const databaseId = dbIdSetting ? (JSON.parse(dbIdSetting.value_json) as string) : '';

  if (!notionToken || !databaseId) {
    return { synced: 0, note: 'NOTION_TOKEN atau Notion Database ID belum diisi di Settings' };
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 25 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { synced: 0, note: `Notion API returned HTTP ${res.status}` };
    }
    const payload = (await res.json()) as {
      results?: Array<{
        id: string;
        url?: string;
        properties?: Record<
          string,
          {
            type?: string;
            title?: Array<{ plain_text?: string }>;
            date?: { start?: string; end?: string | null } | null;
          }
        >;
      }>;
    };

    let synced = 0;
    const upsert = db.prepare(
      `INSERT INTO calendar_events (id, source, external_id, title, start_at, end_at, color, notes, synced_at)
       VALUES (?, 'notion', ?, ?, ?, ?, '#a855f7', ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         start_at = excluded.start_at,
         end_at = excluded.end_at,
         synced_at = datetime('now')`,
    );

    for (const page of payload.results ?? []) {
      const props = Object.values(page.properties ?? {});
      const titleProp = props.find((p) => p.type === 'title');
      const dateProp = props.find((p) => p.type === 'date' && p.date?.start);
      const title = titleProp?.title?.map((t) => t.plain_text ?? '').join('') || 'Acara Notion';
      const start = dateProp?.date?.start;
      if (!start) continue;
      upsert.run(`notion_${page.id}`, page.id, title, start, dateProp?.date?.end ?? null, page.url ?? 'Notion');
      synced++;
    }

    sseBus.emit('alarm:update', { notionSynced: synced });
    return { synced, note: `${synced} agenda Notion berhasil disinkronkan` };
  } catch (err) {
    return { synced: 0, note: err instanceof Error ? err.message : 'Notion sync gagal' };
  }
}

export function toggleSaveNewsArticle(articleId: string, saved: boolean): void {
  const db = getDb();
  db.prepare('UPDATE news_articles SET is_saved = ? WHERE id = ?').run(saved ? 1 : 0, articleId);
}
