import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: true, // we validate redirect destinations separately
    credentials: true,
  })
);

const {
  PORT = '5174',
  FRONTEND_URL,
  HMAC_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  TIKTOK_REDIRECT_URI,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    console.warn(`⚠️  Missing env var: ${name} (TikTok OAuth won't work)`);
  }
}

// Env validation (warn instead of crash so audio-convert works standalone)
requireEnv('FRONTEND_URL', FRONTEND_URL);
requireEnv('HMAC_SECRET', HMAC_SECRET);
requireEnv('SUPABASE_URL', SUPABASE_URL);
requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);
requireEnv('TIKTOK_CLIENT_KEY', TIKTOK_CLIENT_KEY);
requireEnv('TIKTOK_CLIENT_SECRET', TIKTOK_CLIENT_SECRET);
requireEnv('TIKTOK_REDIRECT_URI', TIKTOK_REDIRECT_URI);

function hmacSha256Base64Url(input) {
  const h = crypto.createHmac('sha256', HMAC_SECRET);
  h.update(input);
  return h.digest('base64url');
}

function randomString(len = 32) {
  return crypto.randomBytes(len).toString('base64url');
}

function buildState(payload) {
  // payload: { nonce, user_id, company_id, ts }
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = hmacSha256Base64Url(b64);
  return `${b64}.${sig}`;
}

function parseAndVerifyState(state) {
  if (!state || !state.includes('.')) return null;
  const [b64, sig] = state.split('.', 2);
  const expected = hmacSha256Base64Url(b64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function supabaseAdminUpsertTikTokConnection(row) {
  // Upsert into public.tiktok_connections (you need to create this table; see docs/tiktok_setup.md)
  const url = `${SUPABASE_URL}/rest/v1/tiktok_connections?on_conflict=user_id,company_id`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Supabase upsert failed: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  return data?.[0] ?? null;
}

async function tiktokExchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: TIKTOK_REDIRECT_URI,
  });

  const resp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await resp.json();
  if (!resp.ok || json?.error) {
    throw new Error(`TikTok token exchange error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function tiktokFetchUserInfo(accessToken) {
  const fields = [
    'open_id',
    'union_id',
    'display_name',
    'avatar_url',
    'avatar_url_100',
    'avatar_large_url',
  ].join(',');

  const url = `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const json = await resp.json();
  if (!resp.ok || json?.error) {
    throw new Error(`TikTok user info error: ${JSON.stringify(json)}`);
  }

  // docs typically return: { data: { user: { ... } }, error: { ... } }
  return json?.data?.user ?? null;
}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Start OAuth
// The frontend should call this while the user is logged-in to the CRM (Supabase auth).
// We bind the connection to user_id + company_id inside the signed state.
app.get('/auth/tiktok/start', (req, res) => {
  const user_id = String(req.query.user_id || '');
  const company_id = String(req.query.company_id || '');

  if (!user_id || !company_id) {
    return res.status(400).json({ error: 'Missing user_id or company_id' });
  }

  const csrf = randomString(24);
  res.cookie('tiktok_csrf', csrf, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 5 * 60 * 1000,
  });

  const state = buildState({ nonce: csrf, user_id, company_id, ts: Date.now() });

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic');
  url.searchParams.set('redirect_uri', TIKTOK_REDIRECT_URI);
  url.searchParams.set('state', state);

  // Optional: force consent screen
  // url.searchParams.set('disable_auto_auth', '1');

  return res.redirect(url.toString());
});

// Callback
app.get('/auth/tiktok/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      const msg = `tiktok_oauth_error=${encodeURIComponent(String(error))}&desc=${encodeURIComponent(
        String(error_description || '')
      )}`;
      return res.redirect(`${FRONTEND_URL}/settings?tab=integrations&${msg}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code/state');
    }

    const csrfCookie = req.cookies?.tiktok_csrf;
    const parsed = parseAndVerifyState(String(state));

    if (!csrfCookie || !parsed || parsed.nonce !== csrfCookie) {
      return res.status(400).send('Invalid state');
    }

    const tokenBundle = await tiktokExchangeCodeForToken(String(code));
    const userInfo = await tiktokFetchUserInfo(tokenBundle.access_token);

    const row = {
      user_id: parsed.user_id,
      company_id: parsed.company_id,
      open_id: tokenBundle.open_id ?? userInfo?.open_id ?? null,
      union_id: userInfo?.union_id ?? null,
      display_name: userInfo?.display_name ?? null,
      avatar_url: userInfo?.avatar_url ?? userInfo?.avatar_large_url ?? null,
      scope: tokenBundle.scope ?? 'user.info.basic',
      token_type: tokenBundle.token_type ?? null,
      access_token: tokenBundle.access_token,
      refresh_token: tokenBundle.refresh_token,
      expires_in: tokenBundle.expires_in ?? null,
      refresh_expires_in: tokenBundle.refresh_expires_in ?? null,
      obtained_at: new Date().toISOString(),
      raw: {
        tokenBundle,
        userInfo,
      },
    };

    await supabaseAdminUpsertTikTokConnection(row);

    // Clear csrf cookie
    res.clearCookie('tiktok_csrf');

    return res.redirect(`${FRONTEND_URL}/settings?tab=integrations&tiktok=connected`);
  } catch (e) {
    console.error(e);
    return res.redirect(
      `${FRONTEND_URL}/settings?tab=integrations&tiktok=error&message=${encodeURIComponent(
        e?.message || 'unknown'
      )}`
    );
  }
});

// ─── Audio OGG → M4A conversion for iOS ───
const audioCache = new Map(); // url → { buffer, createdAt }
const CACHE_TTL = 30 * 60 * 1000; // 30 min

// Cleanup old cache entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of audioCache) {
    if (now - val.createdAt > CACHE_TTL) audioCache.delete(key);
  }
}, 10 * 60 * 1000);

app.get('/api/audio-convert', async (req, res) => {
  const oggUrl = req.query.url;
  if (!oggUrl || typeof oggUrl !== 'string') {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  try {
    // Check cache
    const cached = audioCache.get(oggUrl);
    if (cached) {
      res.set('Content-Type', 'audio/mp4');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cached.buffer);
    }

    // Download OGG
    const response = await fetch(oggUrl);
    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch audio: ${response.status}` });
    }

    const oggBuffer = Buffer.from(await response.arrayBuffer());

    // Write to temp file
    const tmpIn = join(tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.ogg`);
    const tmpOut = tmpIn.replace('.ogg', '.m4a');

    await writeFile(tmpIn, oggBuffer);

    // Convert with ffmpeg
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', tmpIn,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        tmpOut,
      ], { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`ffmpeg error: ${err.message}\n${stderr}`));
        else resolve();
      });
    });

    const m4aBuffer = await readFile(tmpOut);

    // Cleanup temp files
    await unlink(tmpIn).catch(() => {});
    await unlink(tmpOut).catch(() => {});

    // Cache result
    audioCache.set(oggUrl, { buffer: m4aBuffer, createdAt: Date.now() });

    res.set('Content-Type', 'audio/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(m4aBuffer);
  } catch (err) {
    console.error('audio-convert error:', err);
    return res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

app.listen(Number(PORT), () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
