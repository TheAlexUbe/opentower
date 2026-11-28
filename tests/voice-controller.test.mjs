import assert from 'node:assert/strict';
import { VoiceController } from '../src/voice.js';

function makeElement() {
  return {
    textContent: '',
    title: '',
    disabled: false,
    dataset: {},
    value: '',
    listeners: {},
    classList: {
      classes: new Set(),
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
      toggle(name, on) { if (on) this.classes.add(name); else this.classes.delete(name); },
      contains(name) { return this.classes.has(name); },
    },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}

function makeRoot() {
  const elements = {
    '#btn-mic': makeElement(),
    '#btn-tts': makeElement(),
    '#cmd': makeElement(),
    '#voice-toast': makeElement(),
  };
  return {
    elements,
    querySelector: (sel) => elements[sel] || null,
  };
}

function makeRecognition() {
  return class FakeRecognition {
    constructor() {
      this.started = 0;
      this.stopped = 0;
    }
    start() { this.started += 1; this.onstart?.(); }
    stop() { this.stopped += 1; this.onend?.(); }
  };
}

function makeSynth() {
  const spoken = [];
  return {
    spoken,
    cancelled: 0,
    getVoices: () => [],
    addEventListener: () => {},
    speak: (utterance) => { spoken.push(utterance); },
    cancel() { this.cancelled += 1; },
  };
}

{
  const root = makeRoot();
  const recognitionClass = makeRecognition();
  const synth = makeSynth();
  const sent = [];
  const logs = [];
  const engine = { radio: [], mode: 'tracon', log: (...args) => logs.push(args) };
  const voice = new VoiceController({
    root,
    getEngine: () => engine,
    getLang: () => 'en',
    tr: (key) => key,
    onTransmit: (text, options) => sent.push([text, options]),
    SpeechRecognition: recognitionClass,
    speechSynthesis: synth,
    navigatorObject: null,
  });

  assert.equal(voice.recognition.lang, 'en-US');
  assert.equal(root.elements['#btn-tts'].textContent, 'voiceOn');
  voice.setLanguage('es');
  assert.equal(voice.recognition.lang, 'es-ES');

  const final = Object.assign([{ transcript: 'turn left heading 270' }], { isFinal: true });
  voice.recognition.onresult({ resultIndex: 0, results: [final] });
  assert.deepEqual(sent, [['turn left heading 270', { voice: true }]]);
  assert.equal(root.elements['#cmd'].value, 'turn left heading 270');

  voice.voiceError('not-allowed');
  assert.match(root.elements['#voice-toast'].textContent, /permission/i);
  assert.equal(logs[0][0], 'SYS');
  assert.match(logs[0][1], /MIC:/);

  voice.toggleTts();
  assert.equal(root.elements['#btn-tts'].textContent, 'voiceOff');
  assert.equal(root.elements['#btn-tts'].classList.contains('off'), true);

  voice.toggleMic();
  assert.equal(voice.recognition.started, 1);
  assert.equal(voice.listening, true);
  voice.toggleMic();
  assert.equal(voice.recognition.stopped, 1);
  assert.equal(voice.listening, false);
}

// Unsupported browsers keep typing available and disable the mic button.
{
  const root = makeRoot();
  const voice = new VoiceController({
    root,
    getLang: () => 'en',
    tr: (key) => key,
    SpeechRecognition: null,
    speechSynthesis: null,
    navigatorObject: null,
  });
  assert.equal(root.elements['#btn-mic'].disabled, true);
  assert.equal(root.elements['#btn-mic'].title, 'micTitleUnsupported');
  voice.toggleMic();
  assert.match(root.elements['#voice-toast'].textContent, /micUnsupported/);
}

console.log('OpenTower voice-controller checks passed');
