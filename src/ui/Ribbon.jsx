import { useState } from 'react';
import { useStore } from '../store.js';
import { NoteIcon, RestIcon } from './icons.jsx';
import { DURATIONS, ARTICULATIONS, ORNAMENTS, DYNAMICS, CLEFS, TECHNIQUES } from '../core/theory.js';
import { exportMusicXML, importMusicXML } from '../core/musicxml.js';
import { exportMIDI } from '../core/midi.js';
import {
  downloadText, downloadBlob, pickFile, safeName, currentScoreSVG, svgToPngBlob,
} from '../core/io.js';
import { audio } from '../audio/engine.js';
import { ARRANGE_STYLES } from '../core/arrange.js';

const TABS = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'note-input', label: 'Note Input' },
  { id: 'notations', label: 'Notations' },
  { id: 'text', label: 'Text' },
  { id: 'play', label: 'Play' },
  { id: 'layout', label: 'Layout' },
  { id: 'view', label: 'View' },
];

const TECHNIQUE_GLYPHS = { arrastre: '◤', latigo: '↗', chicharra: '✕', tambor: '⊗' };
const TECHNIQUE_HINTS = {
  arrastre: 'Arrastre — the drag up into the beat',
  latigo: 'Látigo — the whip glissando',
  chicharra: 'Chicharra — bowed behind the bridge',
  tambor: 'Tambor — damped, imitating a drum',
};

function Group({ label, children }) {
  return (
    <div className="group">
      <div className="group-items">{children}</div>
      <div className="group-label">{label}</div>
    </div>
  );
}

function TBtn({ active, onClick, title, children, disabled, tall, cap }) {
  return (
    <button
      type="button"
      className={`tbtn${active ? ' active' : ''}${tall ? ' tall' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
      {cap && <span className="cap">{cap}</span>}
    </button>
  );
}

export default function Ribbon({ onDialog }) {
  const tab = useStore((s) => s.view.ribbonTab);
  const setView = useStore((s) => s.setView);

  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setView({ ribbonTab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ribbon-body">
        {tab === 'file' && <FileTab onDialog={onDialog} />}
        {tab === 'home' && <HomeTab onDialog={onDialog} />}
        {tab === 'note-input' && <NoteInputTab />}
        {tab === 'notations' && <NotationsTab onDialog={onDialog} />}
        {tab === 'text' && <TextTab onDialog={onDialog} />}
        {tab === 'play' && <PlayTab />}
        {tab === 'layout' && <LayoutTab />}
        {tab === 'view' && <ViewTab onDialog={onDialog} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ File

function FileTab({ onDialog }) {
  const score = useStore((s) => s.score);
  const replaceScore = useStore((s) => s.replaceScore);
  const setStatus = useStore((s) => s.setStatus);

  const openFile = async () => {
    const file = await pickFile('.json,.musicxml,.xml,.mxl');
    if (!file) return;
    try {
      if (/\.(musicxml|xml)$/i.test(file.name)) {
        replaceScore(importMusicXML(file.text), 'import');
        setStatus(`Imported ${file.name}`);
      } else {
        const data = JSON.parse(file.text);
        if (!data.parts) throw new Error('Not a MaxTunes score file.');
        replaceScore(data, 'open');
        setStatus(`Opened ${file.name}`);
      }
    } catch (err) {
      setStatus(`Could not open file: ${err.message}`);
    }
  };

  const exportPNG = async () => {
    const svg = currentScoreSVG();
    if (!svg) return;
    const blob = await svgToPngBlob(svg, 2);
    if (blob) downloadBlob(`${safeName(score.title)}.png`, blob);
  };

  return (
    <>
      <Group label="Score">
        <TBtn tall cap="New" onClick={() => onDialog('new')} title="New score">📄</TBtn>
        <TBtn tall cap="Open" onClick={openFile} title="Open a MaxTunes or MusicXML file">📂</TBtn>
        <TBtn
          tall
          cap="Save"
          title="Save as .maxtunes.json"
          onClick={() => {
            downloadText(`${safeName(score.title)}.maxtunes.json`, JSON.stringify(score, null, 2), 'application/json');
            setStatus('Score saved to your downloads');
          }}
        >💾</TBtn>
      </Group>
      <Group label="Export">
        <TBtn
          tall
          cap="MusicXML"
          title="Export MusicXML for Sibelius, Finale, MuseScore…"
          onClick={() => downloadText(`${safeName(score.title)}.musicxml`, exportMusicXML(score), 'application/vnd.recordare.musicxml+xml')}
        >🎼</TBtn>
        <TBtn
          tall
          cap="MIDI"
          title="Export a standard MIDI file"
          onClick={() => downloadBlob(`${safeName(score.title)}.mid`, new Blob([exportMIDI(score)], { type: 'audio/midi' }))}
        >🎹</TBtn>
        <TBtn
          tall
          cap="SVG"
          title="Export the engraved score as SVG"
          onClick={() => {
            const svg = currentScoreSVG();
            if (svg) downloadText(`${safeName(score.title)}.svg`, svg, 'image/svg+xml');
          }}
        >🖼️</TBtn>
        <TBtn tall cap="PNG" title="Export a PNG image" onClick={exportPNG}>🏞️</TBtn>
        <TBtn tall cap="Print" title="Print the score" onClick={() => window.print()}>🖨️</TBtn>
      </Group>
      <Group label="Setup">
        <TBtn tall cap="Instruments" onClick={() => onDialog('instruments')}>🎻</TBtn>
        <TBtn tall cap="Score Info" onClick={() => onDialog('info')}>ℹ️</TBtn>
        <TBtn tall cap="Shortcuts" onClick={() => onDialog('shortcuts')}>⌨️</TBtn>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Home

function HomeTab({ onDialog }) {
  const { undo, redo, copySelection, paste, addMeasures, deleteSelection } = useStore.getState();
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const cursor = useStore((s) => s.cursor);
  const removeMeasure = useStore((s) => s.removeMeasure);

  return (
    <>
      <Group label="History">
        <TBtn tall cap="Undo" onClick={undo} disabled={!past} title="Undo (⌘Z)">↶</TBtn>
        <TBtn tall cap="Redo" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)">↷</TBtn>
      </Group>
      <Group label="Clipboard">
        <TBtn tall cap="Copy bar" onClick={copySelection} title="Copy the current bar (⌘C)">⧉</TBtn>
        <TBtn tall cap="Paste" onClick={paste} title="Paste at the caret (⌘V)">📋</TBtn>
        <TBtn tall cap="Delete" onClick={deleteSelection} title="Turn selection into rests (⌫)">🗑️</TBtn>
      </Group>
      <Group label="Bars">
        <TBtn tall cap="+1 bar" onClick={() => addMeasures(1)}>▮</TBtn>
        <TBtn tall cap="+4 bars" onClick={() => addMeasures(4)}>▮▮</TBtn>
        <TBtn tall cap="Delete bar" onClick={() => removeMeasure(cursor.measureIndex)}>▯</TBtn>
      </Group>
      <Group label="Instruments">
        <TBtn tall cap="Add / remove" onClick={() => onDialog('instruments')}>🎺</TBtn>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Note input

function NoteInputTab() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const applyDurationToSelection = useStore((s) => s.applyDurationToSelection);
  const toggleDot = useStore((s) => s.toggleDot);
  const inputRest = useStore((s) => s.inputRest);
  const setAccidentalOnSelection = useStore((s) => s.setAccidentalOnSelection);
  const toggleTie = useStore((s) => s.toggleTie);
  const makeTuplet = useStore((s) => s.makeTuplet);
  const cursor = useStore((s) => s.cursor);
  const setVoice = useStore((s) => s.setVoice);
  const listen = useStore((s) => s.listen);
  const setListen = useStore((s) => s.setListen);
  const startListening = useStore((s) => s.startListening);
  const stopListening = useStore((s) => s.stopListening);
  const listening = listen.phase !== 'idle';

  return (
    <>
      <Group label="Input">
        <TBtn
          tall
          active={tool.noteInput}
          cap={tool.noteInput ? 'On' : 'Off'}
          title="Note input mode (N). Click the staff to write notes."
          onClick={() => setTool({ noteInput: !tool.noteInput })}
        >✎</TBtn>
        <TBtn tall cap="Rest" title="Insert a rest (0)" onClick={inputRest}>
          <RestIcon base={tool.duration.base} />
        </TBtn>
      </Group>

      <Group label="Listen">
        <TBtn
          tall
          active={listening}
          cap={listening ? 'Stop' : 'Record'}
          title="Play your instrument after a one-bar count-in; the notes are written at the caret's bar and arranged (⌘⇧F)"
          onClick={listening ? stopListening : startListening}
        ><span className="rec-glyph">●</span></TBtn>
        <div className="field">
          <span>Grid</span>
          <select
            value={listen.grid}
            onChange={(e) => setListen({ grid: Number(e.target.value) })}
            title="Shortest note value the recording is snapped to"
          >
            <option value={8}>8ths</option>
            <option value={16}>16ths</option>
          </select>
        </div>
        <TBtn
          active={listen.click}
          cap="Click"
          title="Metronome while recording (the count-in always clicks)"
          onClick={() => setListen({ click: !listen.click })}
        >🥁</TBtn>
        <div className="field">
          <span>Arrange</span>
          <select
            value={listen.arrange}
            onChange={(e) => setListen({ arrange: e.target.value })}
            title="Harmonise what you play and write an accompaniment under it — on the left hand when it's free, otherwise on a piano part"
          >
            {ARRANGE_STYLES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      </Group>

      <Group label="Note value">
        {DURATIONS.map((d, i) => (
          <TBtn
            key={d.base}
            active={tool.duration.base === d.base}
            title={`${d.label} (${i + 1})`}
            onClick={() => applyDurationToSelection(d.base)}
          >
            <NoteIcon base={d.base} />
          </TBtn>
        ))}
        <TBtn active={!!tool.duration.dots} title="Dotted (.)" onClick={toggleDot}>
          <NoteIcon base={4} dots={1} />
        </TBtn>
      </Group>

      <Group label="Accidentals">
        {[[-2, '𝄫'], [-1, '♭'], [0, '♮'], [1, '♯'], [2, '𝄪']].map(([alter, glyph]) => (
          <TBtn
            key={alter}
            active={tool.accidental === alter}
            title={`Accidental ${glyph}`}
            onClick={() => setAccidentalOnSelection(alter)}
          >
            <span className="glyph">{glyph}</span>
          </TBtn>
        ))}
      </Group>

      <Group label="Grouping">
        <TBtn cap="Tie" title="Tie to next note (T)" onClick={toggleTie}>⌣</TBtn>
        <TBtn cap="Triplet" title="3 in the time of 2" onClick={() => makeTuplet(3, 2)}>3</TBtn>
        <TBtn cap="Quintuplet" onClick={() => makeTuplet(5, 4)}>5</TBtn>
        <TBtn cap="Septuplet" onClick={() => makeTuplet(7, 4)}>7</TBtn>
      </Group>

      <Group label="Voices">
        {[0, 1, 2, 3].map((v) => (
          <TBtn
            key={v}
            active={cursor.voiceIndex === v}
            title={`Voice ${v + 1}`}
            onClick={() => setVoice(v)}
          >{v + 1}</TBtn>
        ))}
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Notations

function NotationsTab({ onDialog }) {
  const toggleArticulation = useStore((s) => s.toggleArticulation);
  const setDynamic = useStore((s) => s.setDynamic);
  const setOrnament = useStore((s) => s.setOrnament);
  const makeSlur = useStore((s) => s.makeSlur);
  const setClef = useStore((s) => s.setClef);
  const setBarline = useStore((s) => s.setBarline);
  const toggleRepeat = useStore((s) => s.toggleRepeat);
  const setStem = useStore((s) => s.setStem);
  const setTechnique = useStore((s) => s.setTechnique);
  const applyTangoRhythm = useStore((s) => s.applyTangoRhythm);
  const cursor = useStore((s) => s.cursor);

  return (
    <>
      <Group label="Articulations">
        {ARTICULATIONS.map((a) => (
          <TBtn key={a.id} title={a.label} onClick={() => toggleArticulation(a.id)}>
            <span className="glyph">{a.glyph}</span>
          </TBtn>
        ))}
      </Group>
      <Group label="Dynamics">
        {DYNAMICS.map((d) => (
          <TBtn key={d} title={`Dynamic ${d}`} onClick={() => setDynamic(d)}>
            <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: 13 }}>{d}</span>
          </TBtn>
        ))}
      </Group>
      <Group label="Lines & ornaments">
        <TBtn cap="Slur" title="Slur across the selection (S)" onClick={makeSlur}>⌒</TBtn>
        {ORNAMENTS.map((o) => (
          <TBtn key={o.id} cap={o.label} onClick={() => setOrnament(o.id)}>
            <span className="glyph">{o.id === 'trill' ? 'tr' : o.id === 'turn' ? '∾' : '↯'}</span>
          </TBtn>
        ))}
        <TBtn cap="Stem ↑" onClick={() => setStem('up')}>↑</TBtn>
        <TBtn cap="Stem ↓" onClick={() => setStem('down')}>↓</TBtn>
        <TBtn cap="Auto" onClick={() => setStem('auto')}>⇅</TBtn>
      </Group>
      <Group label="Tango">
        {TECHNIQUES.map((t) => (
          <TBtn
            key={t.id}
            cap={t.label}
            title={TECHNIQUE_HINTS[t.id]}
            onClick={() => setTechnique(t.id)}
          >{TECHNIQUE_GLYPHS[t.id]}</TBtn>
        ))}
        <TBtn
          cap="Marcato 4"
          title="Accent every beat of this bar and mark it marcato en 4"
          onClick={() => applyTangoRhythm('marcato4')}
        >4</TBtn>
        <TBtn
          cap="Síncopa"
          title="Accent the 3-3-2 grouping of this bar"
          onClick={() => applyTangoRhythm('sincopa')}
        >3·3·2</TBtn>
      </Group>
      <Group label="Clef">
        {Object.entries(CLEFS).map(([id, c]) => (
          <TBtn key={id} cap={c.label} onClick={() => setClef(id)}>
            <span className="glyph">{id === 'bass' ? '𝄢' : id === 'treble' ? '𝄞' : id === 'percussion' ? '𝄥' : '𝄡'}</span>
          </TBtn>
        ))}
      </Group>
      <Group label="Signatures">
        <TBtn tall cap="Key" onClick={() => onDialog('key')}>♯♭</TBtn>
        <TBtn tall cap="Time" onClick={() => onDialog('time')}>𝄴</TBtn>
      </Group>
      <Group label="Barlines">
        <TBtn cap="Single" onClick={() => setBarline(cursor.measureIndex, null)}>|</TBtn>
        <TBtn cap="Double" onClick={() => setBarline(cursor.measureIndex, 'double')}>‖</TBtn>
        <TBtn cap="Final" onClick={() => setBarline(cursor.measureIndex, 'final')}>𝄂</TBtn>
        <TBtn cap="Repeat ⟨" onClick={() => toggleRepeat(cursor.measureIndex, 'startRepeat')}>𝄆</TBtn>
        <TBtn cap="Repeat ⟩" onClick={() => toggleRepeat(cursor.measureIndex, 'endRepeat')}>𝄇</TBtn>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Text

function TextTab({ onDialog }) {
  const selection = useStore((s) => s.selection);
  const cursor = useStore((s) => s.cursor);
  const setRehearsal = useStore((s) => s.setRehearsal);
  const apply = useStore((s) => s.apply);

  const promptFor = (label, run) => {
    const value = window.prompt(label);
    if (value !== null) run(value);
  };

  return (
    <>
      <Group label="Lyrics">
        <TBtn
          tall
          cap="Add lyric"
          disabled={!selection.length}
          onClick={() => onDialog('lyrics')}
        >🗣️</TBtn>
      </Group>
      <Group label="Chord symbols">
        <TBtn
          tall
          cap="Cifrado"
          title="Add a chord symbol above the selected note (⌘K). Enter or Space moves to the next note."
          onClick={() => useStore.getState().startChordEntry()}
        >A♭m7</TBtn>
      </Group>
      <Group label="Score text">
        <TBtn
          tall
          cap="Expression"
          disabled={!selection.length}
          onClick={() => promptFor('Expression text (e.g. dolce)', (text) => apply((d) => {
            for (const id of selection) {
              const loc = findIn(d, id);
              if (loc) loc.text = text;
            }
          }, 'text'))}
        >𝑓</TBtn>
        <TBtn
          tall
          cap="Bar text"
          onClick={() => promptFor('Text above this bar', (text) => apply((d) => {
            d.measures[cursor.measureIndex].text = text || null;
          }, 'bar text'))}
        >T</TBtn>
        <TBtn
          tall
          cap="Rehearsal"
          onClick={() => promptFor('Rehearsal mark (e.g. A)', (mark) => setRehearsal(cursor.measureIndex, mark))}
        >Ⓐ</TBtn>
      </Group>
    </>
  );
}

function findIn(score, id) {
  for (const part of score.parts) {
    for (const staff of part.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          const hit = voice.find((e) => e.id === id);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ Play

function PlayTab() {
  const playback = useStore((s) => s.playback);
  const setPlayback = useStore((s) => s.setPlayback);
  const score = useStore((s) => s.score);
  const setTempo = useStore((s) => s.setTempo);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const togglePlay = useStore((s) => s.togglePlay);
  const stopPlayback = useStore((s) => s.stopPlayback);
  const play = useStore((s) => s.play);
  const [volume, setVolume] = useState(0.85);
  const [reverb, setReverb] = useState(0.16);

  return (
    <>
      <Group label="Transport">
        <TBtn tall cap={playback.playing ? 'Pause' : 'Play'} onClick={togglePlay}>
          {playback.playing ? '⏸' : '▶'}
        </TBtn>
        <TBtn tall cap="Stop" onClick={stopPlayback}>⏹</TBtn>
        <TBtn tall cap="From caret" onClick={() => play(true)}>⏭</TBtn>
      </Group>
      <Group label="Tempo">
        <div className="field">
          <span>♩ =</span>
          <input
            type="number"
            min="20"
            max="300"
            value={score.tempo}
            onChange={(e) => setTempo(Math.max(20, Math.min(300, Number(e.target.value) || 100)))}
          />
        </div>
        <div className="field">
          <span>Rate</span>
          <input
            type="range"
            min="0.5"
            max="1.8"
            step="0.05"
            value={playback.tempoScale}
            onChange={(e) => setPlayback({ tempoScale: Number(e.target.value) })}
          />
          <span>{playback.tempoScale.toFixed(2)}×</span>
        </div>
      </Group>
      <Group label="Options">
        <TBtn
          active={playback.metronome}
          cap="Click"
          onClick={() => setPlayback({ metronome: !playback.metronome })}
        >🥁</TBtn>
        <TBtn
          active={playback.countIn}
          cap="Count-in"
          onClick={() => setPlayback({ countIn: !playback.countIn })}
        >1234</TBtn>
        <TBtn
          active={playback.followPlayhead}
          cap="Follow"
          onClick={() => setPlayback({ followPlayhead: !playback.followPlayhead })}
        >👁️</TBtn>
        <TBtn active={!!playback.loop} cap="Loop" onClick={useStore.getState().toggleLoop}>🔁</TBtn>
      </Group>
      <Group label="Mix">
        <div className="field">
          <span>Volume</span>
          <input
            type="range" min="0" max="1" step="0.02" value={volume}
            onChange={(e) => { setVolume(Number(e.target.value)); audio.setMasterVolume(Number(e.target.value)); }}
          />
        </div>
        <div className="field">
          <span>Reverb</span>
          <input
            type="range" min="0" max="0.5" step="0.01" value={reverb}
            onChange={(e) => { setReverb(Number(e.target.value)); audio.setReverb(Number(e.target.value)); }}
          />
        </div>
        <TBtn active={view.showMixer} cap="Mixer" onClick={() => setView({ showMixer: !view.showMixer })}>🎚️</TBtn>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Layout

function LayoutTab() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cursor = useStore((s) => s.cursor);
  const toggleSystemBreak = useStore((s) => s.toggleSystemBreak);
  const transposeAll = useStore((s) => s.transposeAll);

  return (
    <>
      <Group label="Zoom">
        <TBtn cap="−" onClick={() => setView({ zoom: Math.max(0.5, +(view.zoom - 0.1).toFixed(2)) })}>🔍</TBtn>
        <div className="field"><b>{Math.round(view.zoom * 100)}%</b></div>
        <TBtn cap="+" onClick={() => setView({ zoom: Math.min(2.2, +(view.zoom + 0.1).toFixed(2)) })}>🔎</TBtn>
        <TBtn cap="Reset" onClick={() => setView({ zoom: 1 })}>100%</TBtn>
      </Group>
      <Group label="Breaks">
        <TBtn tall cap="System break" onClick={() => toggleSystemBreak(cursor.measureIndex)}>⏎</TBtn>
      </Group>
      <Group label="Transpose">
        <TBtn cap="−8ve" onClick={() => transposeAll(-12)}>⇊</TBtn>
        <TBtn cap="−1" onClick={() => transposeAll(-1)}>↓</TBtn>
        <TBtn cap="+1" onClick={() => transposeAll(1)}>↑</TBtn>
        <TBtn cap="+8ve" onClick={() => transposeAll(12)}>⇈</TBtn>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ View

function ViewTab({ onDialog }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <>
      <Group label="Panels">
        <TBtn active={view.showInspector} cap="Inspector" onClick={() => setView({ showInspector: !view.showInspector })}>🧾</TBtn>
        <TBtn active={view.showKeyboard} cap="Keyboard" onClick={() => setView({ showKeyboard: !view.showKeyboard })}>🎹</TBtn>
        <TBtn active={view.showMixer} cap="Mixer" onClick={() => setView({ showMixer: !view.showMixer })}>🎚️</TBtn>
      </Group>
      <Group label="Appearance">
        <TBtn
          active={view.theme === 'dark'}
          cap={view.theme === 'dark' ? 'Dark' : 'Light'}
          onClick={() => setView({ theme: view.theme === 'dark' ? 'light' : 'dark' })}
        >{view.theme === 'dark' ? '🌙' : '☀️'}</TBtn>
      </Group>
      <Group label="Help">
        <TBtn tall cap="Shortcuts" onClick={() => onDialog('shortcuts')}>⌨️</TBtn>
        <TBtn tall cap="About" onClick={() => onDialog('about')}>♪</TBtn>
      </Group>
    </>
  );
}
