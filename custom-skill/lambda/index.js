'use strict';

// Alexa-hosted Lambda entry point. No credentials or user data are sent to GitHub.
const FEED_URL = 'https://raw.githubusercontent.com/Mediajobsreport/mjr-morning-brief-audio/main/feed.xml';
const MAX_BYTES = 128 * 1024;
const MAX_SPEECH = 7800;
const HELP = 'MJR Morning Brief brings you the latest published media industry news from Media Jobs Report. Say play the brief, repeat the brief, or stop.';
const REPROMPT = 'Say play the brief to hear the latest edition, or stop to exit.';
const UNAVAILABLE = 'The Morning Brief is unavailable right now. Please try again later, or visit Media Jobs Report dot com.';

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const n = entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
  });
}

function field(item, name) {
  const match = item.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  if (!match) throw new Error('Missing feed field');
  // The publisher uses escaped plain text. CDATA and basic HTML are also safe as text.
  return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function parseBrief(xml, now = new Date()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)
      || !/<rss\b/i.test(xml) || !/<\/rss>\s*$/i.test(xml)) throw new Error('Invalid RSS');
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!items.length) throw new Error('Empty feed');
  const editions = items.map(([, item]) => ({ title: field(item, 'title'), speech: field(item, 'description'), published: new Date(field(item, 'pubDate')) }));
  if (editions.some(e => !Number.isFinite(e.published.getTime()))) throw new Error('Invalid publication date');
  const latest = editions.sort((a, b) => b.published - a.published)[0];
  const age = now - latest.published;
  if (age < -10 * 60 * 1000 || age > 7 * 24 * 60 * 60 * 1000) throw new Error('Publication outside freshness window');
  if (!latest.speech || latest.title.length > 200) throw new Error('Invalid edition');
  if (dateKey(now) !== dateKey(latest.published)) {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(latest.published);
    latest.speech = 'Here is the latest published edition, from ' + date + '. ' + latest.speech;
  }
  // Never silently shorten or rewrite the selected edition.
  if (latest.speech.length > MAX_SPEECH) throw new Error('Edition exceeds speech limit');
  return latest;
}

async function loadBrief(fetchImpl = globalThis.fetch, now = new Date()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetchImpl(FEED_URL, { signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/xml, text/xml, text/plain' } });
    if (!res.ok || !res.body) throw new Error('Feed unavailable');
    const length = Number(res.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error('Feed too large');
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Feed too large'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return parseBrief(Buffer.concat(chunks).toString('utf8'), now);
  } finally { clearTimeout(timer); }
}

function reply(text, end = true, title = 'MJR Morning Brief') {
  const response = { outputSpeech: { type: 'PlainText', text }, shouldEndSession: end,
    card: { type: 'Simple', title, content: text } };
  if (!end) response.reprompt = { outputSpeech: { type: 'PlainText', text: REPROMPT } };
  return { version: '1.0', response };
}

function createHandler({ fetchImpl = globalThis.fetch, clock = () => new Date(), skillId = process.env.SKILL_ID } = {}) {
  return async function handler(event) {
    // Avoid optional chaining so the Alexa console's parser can read this file.
    const system = event && event.context && event.context.System;
    const session = event && event.session;
    const appId = (system && system.application && system.application.applicationId)
      || (session && session.application && session.application.applicationId);
    if (skillId && appId !== skillId) throw new Error('Skill ID mismatch');
    const request = event && event.request;
    if (!request) return reply(UNAVAILABLE);
    if (request.type === 'SessionEndedRequest') return { version: '1.0', response: {} };
    const userId = (system && system.user && system.user.userId)
      || (session && session.user && session.user.userId);
    if (request.type === 'LaunchRequest' && userId === 'alexa-lambda-availability') {
      return reply('MJR Morning Brief is ready.');
    }
    const name = request.intent && request.intent.name;
    if (request.type === 'IntentRequest' && ['AMAZON.StopIntent', 'AMAZON.CancelIntent'].includes(name)) return reply('Goodbye.');
    if (request.type === 'IntentRequest' && name === 'AMAZON.HelpIntent') return reply(HELP, false);
    if (request.type === 'LaunchRequest' || (request.type === 'IntentRequest' && ['PlayBriefIntent', 'AMAZON.RepeatIntent'].includes(name))) {
      try {
        const brief = await loadBrief(fetchImpl, clock());
        return reply(brief.speech, true, brief.title);
      } catch (error) {
        // Never log request envelopes, tokens, account IDs, or unpublished copy.
        console.warn('Published Morning Brief could not be loaded.');
        return reply(UNAVAILABLE);
      }
    }
    return reply('I can read the latest MJR Morning Brief. Say play the brief, or stop.', false);
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.parseBrief = parseBrief;
exports.loadBrief = loadBrief;
exports.FEED_URL = FEED_URL;
