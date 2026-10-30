import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { Clipboard, Copy, Send, Trash2, Wifi, WifiOff } from 'lucide-react';
import './App.css';

const MAX_TEXT_BYTES = 60 * 1024;

const App = () => {
  const [sharedText, setSharedText] = useState('');
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [notice, setNotice] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const draftBytes = new TextEncoder().encode(draft).length;

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout>;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => setConnection('connected');
      socket.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);
          if (update.type === 'text' && typeof update.text === 'string') {
            setSharedText(update.text);
          }
        } catch {
          setNotice('Received an invalid update.');
        }
      };
      socket.onclose = () => {
        if (!active) return;
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };
    };

    retryTimer = setTimeout(connect, 0);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, []);

  const share = (text: string) => {
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      setNotice('Text is too large to share.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Disconnected. Your draft is still here.');
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'text', text }));
    setNotice('Shared with connected devices.');
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const input = event.currentTarget;
    const text = draft.slice(0, input.selectionStart) + event.clipboardData.getData('text/plain') + draft.slice(input.selectionEnd);
    setDraft(text);
    share(text);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(sharedText);
    } catch {
      const field = document.createElement('textarea');
      field.value = sharedText;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) {
        setNotice('Copy unavailable. Select the shared text instead.');
        return;
      }
    }
    setNotice('Copied to clipboard.');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span>phonble</span></div>
        <div className={`connection ${connection}`} role="status">
          {connection === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span>
        </div>
      </header>

      <section className="workspace" aria-label="Shared clipboard">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Shared workspace / 01</p>
            <h1>Clipboard</h1>
          </div>
          <span className="workspace-type">TEXT ONLY</span>
        </div>

        <div className="panes">
          <section className="pane incoming" aria-labelledby="incoming-heading">
            <div className="pane-heading">
              <div><p className="eyebrow">01 / From your devices</p><h2 id="incoming-heading">Latest text</h2></div>
              <div className="pane-actions">
                <button className="icon-button" title="Copy shared text" aria-label="Copy shared text" onClick={copy} disabled={!sharedText}>
                  <Copy size={18} />
                </button>
                <button className="icon-button" title="Clear shared text" aria-label="Clear shared text" onClick={() => share('')} disabled={!sharedText || connection !== 'connected'}>
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            {sharedText ? <pre className="shared-text">{sharedText}</pre> : (
              <div className="empty-state"><Clipboard size={28} strokeWidth={1.5} /><p>Nothing shared yet.</p></div>
            )}
          </section>

          <section className="pane outgoing" aria-labelledby="outgoing-heading">
            <div className="pane-heading">
              <div><p className="eyebrow">02 / From this device</p><h2 id="outgoing-heading">Send text</h2></div>
              <span className="pane-symbol" aria-hidden="true"><Send size={20} /></span>
            </div>
            <label className="sr-only" htmlFor="draft">Text to share</label>
            <textarea id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={paste} placeholder="Type or paste text here..." spellCheck={false} />
            <div className="compose-footer">
              <span className={draftBytes > MAX_TEXT_BYTES ? 'over-limit' : ''}>{(draftBytes / 1024).toFixed(1)} / 60 KB</span>
              <button className="share-button" onClick={() => share(draft)} disabled={!draft || draftBytes > MAX_TEXT_BYTES || connection !== 'connected'}>
                <Send size={17} /> Share text
              </button>
            </div>
          </section>
        </div>
        <div className="footnote" aria-live="polite">{notice || 'One shared clipboard across connected devices.'}</div>
      </section>
    </main>
  );
};

export default App;
