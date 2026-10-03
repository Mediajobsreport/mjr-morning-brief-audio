'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseBrief, loadBrief, createHandler, FEED_URL, fetchXml } = require('../lambda');
const xml = fs.readFileSync(__dirname + '/fixtures/published-feed.xml', 'utf8');
const now = new Date('2026-10-03T19:00:00Z');
const mockReadFeed = async () => xml;
const event = name => ({ request: name ? { type: 'IntentRequest', intent: { name } } : { type: 'LaunchRequest' } });

test('published edition preserves every story, intro once, final segue and outro', () => {
  const b = parseBrief(xml, now);
  assert.equal((b.speech.match(/From Media Jobs Report, here is/g) || []).length, 1);
  assert.match(b.speech, /And finally, The National Association/);
  for (const name of ['Nielsen', 'Anthony Anderson', 'Yusim Aladro', 'Doug Lederman', 'NRB']) assert.ok(b.speech.includes(name));
  assert.ok(b.speech.endsWith('Visit Media Jobs Report dot com.'));
  assert.match(b.speech, /A&R/);
  assert.ok(!b.speech.includes('&amp;'));
});
test('previous edition is dated; stale and future editions are rejected', () => {
  assert.match(parseBrief(xml, new Date('2026-10-05T12:00:00Z')).speech, /^Here is the latest published edition, from October 3, 2026/);
  assert.throws(() => parseBrief(xml, new Date('2026-10-12T12:00:00Z')));
  assert.throws(() => parseBrief(xml, new Date('2026-10-01T12:00:00Z')));
});
test('empty, malformed, invalid-date, entity-declaration, and oversized editions are rejected', () => {
  for (const bad of ['<rss><channel></channel></rss>', xml.replace('</rss>', ''), xml.replaceAll('2026-10-03T14:11:52Z', 'bad'), '<!DOCTYPE rss>' + xml, xml.replace('From Media Jobs Report,', 'x'.repeat(8000))]) assert.throws(() => parseBrief(bad, now));
});
test('CDATA and XML character references remain text', () => {
  const sample = xml.replace(/<description>From[\s\S]*?<\/description>/, '<description><![CDATA[News &amp; facts &#x1F600; <audio src="untrusted"/>]]></description>');
  assert.equal(parseBrief(sample, now).speech, 'News & facts 😀');
});
test('launch, play, and repeat read same feed and end cleanly', async () => {
  const handler = createHandler({ readFeed: mockReadFeed, clock: () => now });
  for (const name of [undefined, 'PlayBriefIntent', 'AMAZON.RepeatIntent']) {
    const result = await handler(event(name));
    assert.equal(result.response.outputSpeech.type, 'PlainText');
    assert.equal(result.response.outputSpeech.text, parseBrief(xml, now).speech);
    assert.equal(result.response.shouldEndSession, true);
    assert.ok(JSON.stringify(result).length < 120 * 1024);
    assert.ok(result.response.card.title.length + result.response.card.content.length < 8000);
  }
});
test('help/fallback reprompt; stop/cancel/session-end do not fetch', async () => {
  const handler = createHandler({ readFeed: () => { throw Error('unexpected fetch'); } });
  for (const name of ['AMAZON.HelpIntent', 'AMAZON.FallbackIntent']) {
    const r = await handler(event(name));
    assert.equal(r.response.shouldEndSession, false);
    assert.ok(r.response.reprompt);
  }
  for (const name of ['AMAZON.StopIntent', 'AMAZON.CancelIntent']) assert.equal((await handler(event(name))).response.outputSpeech.text, 'Goodbye.');
  assert.deepEqual((await handler({ request: { type: 'SessionEndedRequest' } })).response, {});
  assert.match((await handler({ ...event(), session: { user: { userId: 'alexa-lambda-availability' } } })).response.outputSpeech.text, /ready/);
});
test('network errors fail gracefully; skill ID validation is supported', async () => {
  for (const readFeed of [async () => { throw Error('Feed unavailable'); }, async () => { throw Error('network'); }]) {
    const r = await createHandler({ readFeed })(event());
    assert.match(r.response.outputSpeech.text, /unavailable/);
  }
  await assert.rejects(createHandler({ skillId: 'expected' })(event()), /Skill ID mismatch/);
});
test('HTTPS uses fixed public feed, rejects redirects and bounds response bytes', async () => {
  const { EventEmitter } = require('node:events');
  function client(status, chunks, headers = {}) {
    return (url, options, callback) => {
      assert.equal(url, FEED_URL);
      assert.equal(options.headers.Accept, 'application/xml, text/xml, text/plain');
      const request = new EventEmitter();
      request.destroy = () => { request.destroyed = true; };
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = status;
        response.headers = headers;
        response.destroy = () => { response.destroyed = true; };
        callback(response);
        for (const chunk of chunks) {
          if (!response.destroyed) response.emit('data', Buffer.from(chunk));
        }
        if (!response.destroyed) response.emit('end');
      });
      return request;
    };
  }
  assert.equal(await fetchXml(FEED_URL, client(200, [xml.slice(0, 20), xml.slice(20)])), xml);
  for (const status of [301, 302, 404, 503]) {
    await assert.rejects(fetchXml(FEED_URL, client(status, [])), /unavailable/);
  }
  await assert.rejects(fetchXml(FEED_URL, client(200, ['x'.repeat(129 * 1024)])), /too large/);
  await assert.rejects(fetchXml(FEED_URL, client(200, [], { 'content-length': 129 * 1024 })), /too large/);
  await assert.rejects(fetchXml('https://untrusted.example/'), /Unexpected feed URL/);
});
test('HTTPS cancels hung requests and rejects network errors and incomplete responses', async () => {
  const { EventEmitter } = require('node:events');
  let request;
  const hang = () => {
    request = new EventEmitter();
    request.destroy = () => { request.destroyed = true; };
    return request;
  };
  await assert.rejects(fetchXml(FEED_URL, hang, 20), /timed out/);
  assert.equal(request.destroyed, true);
  for (const failure of ['error', 'aborted', 'close']) {
    await assert.rejects(fetchXml(FEED_URL, (url, options, callback) => {
      const req = hang();
      process.nextTick(() => {
        if (failure === 'error') return req.emit('error', Error('network failure'));
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        res.destroy = () => {};
        callback(res);
        res.emit(failure);
      });
      return req;
    }), /network failure|aborted|closed early/);
  }
});
test('model covers implemented intents and uses spelled acronym', () => {
  const model = require('../skill-package/interactionModels/custom/en-US.json').interactionModel.languageModel;
  assert.equal(model.invocationName, 'm. j. r. morning brief');
  assert.equal(model.intents.length, 6);
});
