// ============================================================
// COLA TUDO ABAIXO DENTRO DO NODE "Process" (Code) DO PROXY YCloud
// Lembra de substituir <<SUPABASE_URL>>, <<SUPABASE_ANON_KEY>>,
// <<SUPABASE_SERVICE_ROLE>> pelos valores reais do seu Supabase.
// ============================================================

// Tudo em um node só — auth + resolve + dispatch + call + format.
// Saída sempre tem __status (HTTP code), ok (boolean) e os campos do payload.

const SUPABASE_URL = '<<SUPABASE_URL>>';
const ANON_KEY = '<<SUPABASE_ANON_KEY>>';
const SERVICE_ROLE = '<<SUPABASE_SERVICE_ROLE>>';
const YCLOUD_BASE = 'https://api.ycloud.com';

const err = (status, error, message, extra = {}) => [{ json: { ok: false, __status: status, error, message, ...extra } }];
const ok = (payload = {}) => [{ json: { ok: true, __status: 200, ...payload } }];

// Helper: faz HTTP request sem lancar excecao em 4xx/5xx; retorna { statusCode, body }.
// Usa helpers.request (legacy com simple:false) se disponivel, com fallback pra httpRequest.
const safeReq = async (opts) => {
  // Tenta helpers.request primeiro (suporta simple:false = nao throw em 4xx/5xx)
  if (this.helpers && typeof this.helpers.request === 'function') {
    try {
      const r = await this.helpers.request({
        method: opts.method || 'GET',
        uri: opts.url,
        headers: opts.headers || {},
        body: opts.body,
        json: opts.json !== false,
        simple: false,
        resolveWithFullResponse: true,
      });
      return { statusCode: r.statusCode || 200, body: r.body };
    } catch (e) {
      return {
        statusCode: 0,
        body: {
          error: 'request_failed',
          message: (e && e.message) || String(e),
          keys: e ? Object.getOwnPropertyNames(e).slice(0, 15) : [],
        },
      };
    }
  }
  // Fallback: httpRequest com extracao defensiva do erro
  try {
    const r = await this.helpers.httpRequest({ ...opts, returnFullResponse: true });
    return { statusCode: r.statusCode || r.status || 200, body: r.body !== undefined ? r.body : r };
  } catch (e) {
    const respData = e && e.response && e.response.data;
    const respStatus = e && e.response && e.response.status;
    const status = respStatus || (e && e.statusCode) || (e && e.httpCode) || 500;
    let body;
    if (respData !== undefined && respData !== null) {
      body = respData;
    } else {
      body = {
        error: 'http_error_no_body',
        message: (e && e.message) || String(e),
        name: e && e.name,
        code: e && e.code,
        cause_message: e && e.cause && e.cause.message,
        keys: e ? Object.getOwnPropertyNames(e).slice(0, 15) : [],
        sent_url: opts.url,
        sent_method: opts.method,
        sent_body_preview: typeof opts.body === 'object' ? Object.keys(opts.body || {}) : null,
      };
    }
    return { statusCode: status, body };
  }
};

const item = $input.first().json;
const headers = item.headers || {};
const auth = headers.authorization || headers.Authorization || '';
const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

if (!token) return err(401, 'missing_token', 'Authorization Bearer token ausente.');

const body = item.body || {};
const bodyApiKey = (body.api_key || '').trim();
const action = body.action || 'list_phones';
const phoneNumberId = (body.phone_number_id || '').trim();

// 1) Valida JWT do usuario
let user;
try {
  user = await this.helpers.httpRequest({
    method: 'GET',
    url: SUPABASE_URL + '/auth/v1/user',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token },
    json: true,
  });
} catch (e) {
  return err(401, 'invalid_token', 'JWT inválido ou expirado.', { detail: (e && e.message) || String(e) });
}
if (!user || !user.id) return err(401, 'invalid_token', 'JWT não retornou usuário.');

// 2) Lookup company_id no profile
const profileRes = await this.helpers.httpRequest({
  method: 'GET',
  url: SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=company_id',
  headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE },
  json: true,
});
const company_id = Array.isArray(profileRes) && profileRes[0] && profileRes[0].company_id;
if (!company_id) return err(400, 'no_company', 'Usuário não tem company_id no profile.');

// 3) Resolve api_key (body > supabase)
let apiKey = bodyApiKey;
if (!apiKey) {
  const credRes = await this.helpers.httpRequest({
    method: 'GET',
    url: SUPABASE_URL + '/rest/v1/company_ycloud_credentials?company_id=eq.' + company_id + '&select=api_key',
    headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE },
    json: true,
  });
  if (Array.isArray(credRes) && credRes[0] && credRes[0].api_key) apiKey = credRes[0].api_key;
}
if (!apiKey) return err(400, 'no_api_key', 'Nenhuma API key YCloud configurada para esta empresa.');

const commonHeaders = { 'X-API-Key': apiKey, 'Accept': 'application/json' };

// 4) Dispatch por action
if (action === 'list_phones') {
  const r = await safeReq({
    method: 'GET',
    url: YCLOUD_BASE + '/v2/whatsapp/phoneNumbers',
    headers: commonHeaders,
    json: true,
  });
  const status = r.statusCode || 0;
  const raw = r.body ?? r;
  if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (Array.isArray(raw.items)) items = raw.items;
  else if (Array.isArray(raw.data)) items = raw.data;
  else if (Array.isArray(raw.results)) items = raw.results;
  const phones = items.map((p) => ({
    phone_number_id: p.id || p.phoneNumberId || p.phone_number_id || '',
    waba_id: p.wabaId || p.waba_id || null,
    display_phone: p.phoneNumber || p.displayPhoneNumber || p.display_phone || null,
    verified_name: p.verifiedName || p.verified_name || null,
    quality_rating: p.qualityRating || p.quality_rating || null,
    status: p.status || null,
  }));
  return ok({ count: phones.length, phones });
}

if (action === 'coexistence_qr') {
  if (!phoneNumberId) return err(400, 'missing_phone_number_id', 'phone_number_id é obrigatório para coexistence_qr');
  const r = await safeReq({
    method: 'POST',
    url: YCLOUD_BASE + '/v2/whatsapp/phoneNumbers/' + encodeURIComponent(phoneNumberId) + '/coexistence/qrCode',
    headers: commonHeaders,
    body: {},
    json: true,
  });
  const status = r.statusCode || 0;
  const raw = r.body ?? r;
  if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
  const qr_code = raw.qrCode || raw.qr_code || raw.code || raw.image || null;
  const qr_image_url = raw.qrCodeUrl || raw.qr_image_url || raw.imageUrl || raw.url || null;
  const expires_at = raw.expiresAt || raw.expires_at || null;
  try {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: SUPABASE_URL + '/rest/v1/ycloud_phone_numbers?phone_number_id=eq.' + encodeURIComponent(phoneNumberId) + '&company_id=eq.' + company_id,
      headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: { coexistence_status: 'pending', coexistence_pending_at: new Date().toISOString() },
      json: true,
    });
  } catch (_) {}
  return ok({ qr_code, qr_image_url, expires_at, raw });
}

if (action === 'phone_status') {
  if (!phoneNumberId) return err(400, 'missing_phone_number_id', 'phone_number_id é obrigatório');
  const r = await safeReq({
    method: 'GET',
    url: YCLOUD_BASE + '/v2/whatsapp/phoneNumbers/' + encodeURIComponent(phoneNumberId),
    headers: commonHeaders,
    json: true,
  });
  const status = r.statusCode || 0;
  const raw = r.body ?? r;
  if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
  const linked = raw.coexistenceStatus === 'linked' || raw.status === 'CONNECTED' || raw.connected === true;
  if (linked) {
    try {
      await this.helpers.httpRequest({
        method: 'PATCH',
        url: SUPABASE_URL + '/rest/v1/ycloud_phone_numbers?phone_number_id=eq.' + encodeURIComponent(phoneNumberId) + '&company_id=eq.' + company_id,
        headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: { coexistence_status: 'linked', coexistence_linked_at: new Date().toISOString() },
        json: true,
      });
    } catch (_) {}
  }
  return ok({ linked, raw });
}

if (action === 'list_templates') {
  const wabaId = (body.waba_id || '').trim();
  if (!wabaId) return err(400, 'missing_waba_id', 'waba_id e obrigatorio para list_templates');
  // YCloud limita limit em 1-100. Pagina ate buscar todos.
  const allItems = [];
  let pageToken = null;
  let pageCount = 0;
  const MAX_PAGES = 10; // ate 1000 templates, suficiente
  while (pageCount < MAX_PAGES) {
    let pageUrl = YCLOUD_BASE + '/v2/whatsapp/templates?wabaId=' + encodeURIComponent(wabaId) + '&limit=100';
    if (pageToken) pageUrl += '&pageToken=' + encodeURIComponent(pageToken);
    const r = await safeReq({ method: 'GET', url: pageUrl, headers: commonHeaders, json: true });
    const status = r.statusCode || 0;
    const raw = r.body ?? r;
    if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
    let items = [];
    if (Array.isArray(raw)) items = raw;
    else if (Array.isArray(raw.items)) items = raw.items;
    else if (Array.isArray(raw.data)) items = raw.data;
    else if (Array.isArray(raw.results)) items = raw.results;
    allItems.push(...items);
    pageToken = (raw && (raw.nextPageToken || raw.next_page_token || raw.nextPage)) || null;
    pageCount++;
    if (!pageToken || items.length === 0) break;
  }
  return ok({ count: allItems.length, templates: allItems });
}

if (action === 'create_template') {
  const tpl = body.template || {};
  if (!tpl.name || !tpl.category || !tpl.language || !Array.isArray(tpl.components)) {
    return err(400, 'invalid_template', 'Campos obrigatorios: name, category, language, components[]');
  }
  const wabaId = (body.waba_id || '').trim();
  if (!wabaId) return err(400, 'missing_waba_id', 'waba_id e obrigatorio para create_template');
  const r = await safeReq({
    method: 'POST',
    url: YCLOUD_BASE + '/v2/whatsapp/templates',
    headers: { ...commonHeaders, 'Content-Type': 'application/json' },
    body: { wabaId, name: tpl.name, category: tpl.category, language: tpl.language, components: tpl.components },
    json: true,
  });
  const status = r.statusCode || 0;
  const raw = r.body ?? r;
  if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
  return ok({ template: raw });
}

if (action === 'delete_template') {
  const wabaId = (body.waba_id || '').trim();
  const name = (body.name || '').trim();
  if (!wabaId || !name) return err(400, 'invalid_request', 'waba_id e name sao obrigatorios');
  const r = await safeReq({
    method: 'DELETE',
    url: YCLOUD_BASE + '/v2/whatsapp/templates?wabaId=' + encodeURIComponent(wabaId) + '&name=' + encodeURIComponent(name),
    headers: commonHeaders,
    json: true,
  });
  const status = r.statusCode || 0;
  const raw = r.body ?? r;
  if (status >= 400) return err(status, 'ycloud_http_' + status, (raw && ((raw.error && raw.error.whatsappApiError && (raw.error.whatsappApiError.error_user_msg || raw.error.whatsappApiError.message)) || (raw.error && raw.error.message) || raw.message || (typeof raw.error === 'string' ? raw.error : null))) || ('YCloud HTTP ' + status), { details: raw });
  return ok({ deleted: true });
}

if (action === 'send_template') {
  // Envia mensagem de TEMPLATE (cobra do Meta, sai fora da janela 24h)
  const fromPhone = (body.from || body.phone_number || '').trim();
  const phoneNumberId = (body.phone_number_id || '').trim();
  const to = (body.to || '').trim();
  const tplName = (body.template_name || body.name || '').trim();
  const language = (body.language || 'pt_BR').trim();
  const components = Array.isArray(body.components) ? body.components : [];
  const clientId = body.client_id || null;
  const renderedBody = body.rendered_body || '';
  const sentByUserId = user && user.id ? user.id : null;

  if (!to) return err(400, 'missing_to');
  if (!tplName) return err(400, 'missing_template_name');
  if (!fromPhone && !phoneNumberId) return err(400, 'missing_from');

  let resolvedFrom = fromPhone;
  let ycloudPhoneRowId = null;
  try {
    const phoneLookupKey = phoneNumberId || fromPhone.replace(/^\+/, '');
    const lookup = await this.helpers.httpRequest({
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/ycloud_phone_numbers?company_id=eq.' + company_id + '&phone_number_id=eq.' + encodeURIComponent(phoneLookupKey) + '&select=id,display_phone&limit=1',
      headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE },
      json: true,
    });
    if (Array.isArray(lookup) && lookup[0]) {
      ycloudPhoneRowId = lookup[0].id;
      if (!resolvedFrom && lookup[0].display_phone) {
        resolvedFrom = String(lookup[0].display_phone).replace(/[^\d+]/g, '');
      }
    }
  } catch (_) {}

  if (!resolvedFrom) return err(400, 'cannot_resolve_from', 'Não consegui descobrir o número da empresa.');

  const ycloudPayload = {
    from: resolvedFrom,
    to,
    type: 'template',
    template: { name: tplName, language: { code: language }, components },
  };

  const r = await safeReq({
    method: 'POST',
    url: YCLOUD_BASE + '/v2/whatsapp/messages',
    headers: { ...commonHeaders, 'Content-Type': 'application/json' },
    body: ycloudPayload,
    json: true,
  });
  const ycStatus = r.statusCode || 0;
  const ycRaw = r.body ?? r;
  if (ycStatus >= 400) return err(ycStatus, 'ycloud_http_' + ycStatus, (ycRaw && ((ycRaw.error && ycRaw.error.whatsappApiError && (ycRaw.error.whatsappApiError.error_user_msg || ycRaw.error.whatsappApiError.message)) || (ycRaw.error && ycRaw.error.message) || ycRaw.message || (typeof ycRaw.error === 'string' ? ycRaw.error : null))) || ('YCloud HTTP ' + ycStatus), { details: ycRaw });

  const wamid = ycRaw.id || ycRaw.messageId || ycRaw.wamid || null;
  const sentTs = ycRaw.timestamp || ycRaw.createTime || new Date().toISOString();
  const remoteJid = String(to).replace(/\D/g, '');

  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/wpp_conversations',
      headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: {
        company_id,
        remote_jid: remoteJid,
        provider: 'ycloud',
        ycloud_phone_number_id: ycloudPhoneRowId,
        message_id: wamid,
        from_me: true,
        message: renderedBody || ('[Template: ' + tplName + ']'),
        message_type: 'template',
        raw_payload: { ...ycRaw, template_name: tplName, template_language: language, template_components: components, client_id: clientId, local_client_id: clientId },
        sent_by_user_id: sentByUserId,
        created_at: sentTs,
        wa_sent_at: sentTs,
      },
      json: true,
    });
  } catch (e) {
    return ok({ wamid, warning: 'template_sent_but_db_insert_failed', detail: (e && e.message) || String(e) });
  }

  return ok({ wamid, sent_at: sentTs });
}

if (action === 'send_message') {
  const fromPhone = (body.from || body.phone_number || '').trim();
  const phoneNumberId = (body.phone_number_id || '').trim();
  const to = (body.to || '').trim();
  const msgType = (body.type || 'text').toLowerCase();
  const text = body.text || '';
  const mediaUrl = body.media_url || null;
  const caption = body.caption || null;
  const clientId = body.client_id || null;
  const sentByUserId = user && user.id ? user.id : null;

  if (!to) return err(400, 'missing_to', 'campo "to" obrigatorio');
  if (!fromPhone && !phoneNumberId) return err(400, 'missing_from', 'envie "from" ou "phone_number_id"');
  if (msgType === 'text' && !text) return err(400, 'missing_text', 'texto vazio');
  if (['image','video','audio','document'].includes(msgType) && !mediaUrl) return err(400, 'missing_media_url');

  const ycloudPayload = { from: fromPhone, to, type: msgType };
  if (msgType === 'text') ycloudPayload.text = { body: text };
  else if (msgType === 'image') ycloudPayload.image = { link: mediaUrl, caption: caption || undefined };
  else if (msgType === 'video') ycloudPayload.video = { link: mediaUrl, caption: caption || undefined };
  else if (msgType === 'audio') ycloudPayload.audio = { link: mediaUrl, voice: true };
  else if (msgType === 'document') ycloudPayload.document = { link: mediaUrl, filename: body.filename || undefined, caption: caption || undefined };

  const r = await safeReq({
    method: 'POST',
    url: YCLOUD_BASE + '/v2/whatsapp/messages',
    headers: { ...commonHeaders, 'Content-Type': 'application/json' },
    body: ycloudPayload,
    json: true,
  });
  const ycStatus = r.statusCode || 0;
  const ycRaw = r.body ?? r;
  if (ycStatus >= 400) return err(ycStatus, 'ycloud_http_' + ycStatus, (ycRaw && ((ycRaw.error && ycRaw.error.whatsappApiError && (ycRaw.error.whatsappApiError.error_user_msg || ycRaw.error.whatsappApiError.message)) || (ycRaw.error && ycRaw.error.message) || ycRaw.message || (typeof ycRaw.error === 'string' ? ycRaw.error : null))) || ('YCloud HTTP ' + ycStatus), { details: ycRaw });

  const wamid = ycRaw.id || ycRaw.messageId || ycRaw.wamid || null;
  const sentTs = ycRaw.timestamp || ycRaw.createTime || new Date().toISOString();

  let ycloudPhoneRowId = phoneNumberId ? null : null;
  try {
    const phoneLookupKey = phoneNumberId || fromPhone.replace(/^\+/, '');
    const lookup = await this.helpers.httpRequest({
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/ycloud_phone_numbers?company_id=eq.' + company_id + '&phone_number_id=eq.' + encodeURIComponent(phoneLookupKey) + '&select=id&limit=1',
      headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE },
      json: true,
    });
    if (Array.isArray(lookup) && lookup[0]) ycloudPhoneRowId = lookup[0].id;
  } catch (_) {}

  const remoteJid = String(to).replace(/\D/g, '');
  const insertPayload = {
    company_id,
    remote_jid: remoteJid,
    provider: 'ycloud',
    ycloud_phone_number_id: ycloudPhoneRowId,
    message_id: wamid,
    from_me: true,
    message: msgType === 'text' ? text : (caption || ''),
    message_type: msgType,
    media_url: mediaUrl,
    raw_payload: { ...ycRaw, client_id: clientId, local_client_id: clientId },
    sent_by_user_id: sentByUserId,
    created_at: sentTs,
    wa_sent_at: sentTs,
  };
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/wpp_conversations',
      headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: insertPayload,
      json: true,
    });
  } catch (e) {
    return ok({ wamid, warning: 'message_sent_but_db_insert_failed', detail: (e && e.message) || String(e) });
  }

  return ok({ wamid, sent_at: sentTs });
}

return err(400, 'unknown_action', 'Action desconhecida: ' + action);
