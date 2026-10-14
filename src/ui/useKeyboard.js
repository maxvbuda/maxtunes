import { useEffect } from 'react';
import { useStore } from '../store.js';
import { downloadText, safeName } from '../core/io.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function typingInField(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (typingInField(e.target)) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      // While recording, any other key would write into the staff being recorded.
      if (s.listen.phase !== 'idle') {
        if (key === ' ' || key === 'Escape') {
          e.preventDefault();
          s.stopListening();
        }
        return;
      }

      if (mod) {
        switch (key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo(); else s.undo();
            return;
          case 'y':
            e.preventDefault(); s.redo(); return;
          case 'c':
            e.preventDefault(); s.copySelection(); return;
          case 'v':
            e.preventDefault(); s.paste(); return;
          case 'k':
            e.preventDefault(); s.startChordEntry(); return;
          case 'f':
            if (!e.shiftKey) return;
            e.preventDefault(); s.startListening(); return;
          case 's':
            e.preventDefault();
            downloadText(`${safeName(s.score.title)}.maxtunes.json`, JSON.stringify(s.score, null, 2), 'application/json');
            s.setStatus('Score saved to your downloads');
            return;
          case '=':
          case '+':
            e.preventDefault(); s.setView({ zoom: Math.min(2.2, +(s.view.zoom + 0.1).toFixed(2)) }); return;
          case '-':
            e.preventDefault(); s.setView({ zoom: Math.max(0.5, +(s.view.zoom - 0.1).toFixed(2)) }); return;
          case 'arrowup':
            e.preventDefault(); s.transposeSelection(12); return;
          case 'arrowdown':
            e.preventDefault(); s.transposeSelection(-12); return;
          default:
            return;
        }
      }

      if (key === ' ') {
        e.preventDefault();
        if (e.shiftKey) s.play(true); else s.togglePlay();
        return;
      }

      if (/^[1-7]$/.test(key)) {
        e.preventDefault();
        s.applyDurationToSelection([1, 2, 4, 8, 16, 32, 64][Number(key) - 1]);
        return;
      }

      const upper = key.toUpperCase();
      if (LETTERS.includes(upper) && !e.altKey) {
        e.preventDefault();
        s.inputLetter(upper, { chord: e.shiftKey });
        return;
      }

      switch (key) {
        case '0':
          e.preventDefault(); s.inputRest(); return;
        case '.':
          e.preventDefault(); s.toggleDot(); return;
        case '#':
          e.preventDefault(); s.setAccidentalOnSelection(1); return;
        case '-':
          e.preventDefault(); s.setAccidentalOnSelection(-1); return;
        case '=':
          e.preventDefault(); s.setAccidentalOnSelection(0); return;
        case 'n':
        case 'N':
          e.preventDefault(); s.setTool({ noteInput: !s.tool.noteInput }); return;
        case 't':
        case 'T':
          e.preventDefault(); s.toggleTie(); return;
        case 's':
        case 'S':
          e.preventDefault(); s.makeSlur(); return;
        case 'Backspace':
        case 'Delete':
          e.preventDefault(); s.deleteSelection(); return;
        case 'Escape':
          e.preventDefault(); s.setSelection([]); return;
        case 'ArrowLeft':
          e.preventDefault(); s.moveCursor(-1); return;
        case 'ArrowRight':
          e.preventDefault(); s.moveCursor(1); return;
        case 'ArrowUp':
          e.preventDefault();
          if (e.altKey) s.moveCursorStaff(-1);
          else if (s.selection.length) s.stepSelection(1);
          else s.moveCursorStaff(-1);
          return;
        case 'ArrowDown':
          e.preventDefault();
          if (e.altKey) s.moveCursorStaff(1);
          else if (s.selection.length) s.stepSelection(-1);
          else s.moveCursorStaff(1);
          return;
        default:
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Optional Web MIDI keyboard input. */
export function useMidiInput(onStatus) {
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return undefined;
    let access = null;
    let cancelled = false;

    const handle = (msg) => {
      const [status, note, velocity] = msg.data;
      if ((status & 0xf0) === 0x90 && velocity > 0) {
        const s = useStore.getState();
        if (s.tool.noteInput) s.inputMidi(note);
      }
    };

    navigator.requestMIDIAccess().then((a) => {
      if (cancelled) return;
      access = a;
      let count = 0;
      a.inputs.forEach((input) => { input.onmidimessage = handle; count++; });
      if (count) onStatus?.(`${count} MIDI input${count > 1 ? 's' : ''} connected`);
      a.onstatechange = () => {
        let n = 0;
        a.inputs.forEach((input) => { input.onmidimessage = handle; n++; });
        onStatus?.(n ? `${n} MIDI input${n > 1 ? 's' : ''} connected` : 'MIDI device disconnected');
      };
    }).catch(() => { /* permission denied or unsupported */ });

    return () => {
      cancelled = true;
      access?.inputs.forEach((input) => { input.onmidimessage = null; });
    };
  }, [onStatus]);
}
