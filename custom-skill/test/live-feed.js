'use strict';
const { loadBrief } = require('../lambda');
loadBrief().then(b => console.log(JSON.stringify({ title: b.title, characters: b.speech.length, estimatedSecondsAt150Wpm: Math.round(b.speech.split(/\s+/).length / 150 * 60) })))
  .catch(() => { console.error('Live published feed check failed.'); process.exitCode = 1; });
