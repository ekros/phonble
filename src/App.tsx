import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, FormEvent } from 'react';
import { Clipboard, Copy, Download, ImagePlus, Send, Trash2, Users, Wifi, WifiOff } from 'lucide-react';
import './App.css';

const MAX_TEXT_BYTES = 60 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

type SharedUpdate =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string };
type Participant = { id: string; name: string };
type ParticipantUpdate = { type: 'participants'; deviceId: string; participants: Participant[] };

const getStoredDeviceName = () => {
  try {
    return window.localStorage.getItem('phonble-device-name') ?? '';
  } catch {
    return '';
  }
};

const isParticipantUpdate = (value: unknown): value is ParticipantUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    update.type === 'participants' &&
    typeof update.deviceId === 'string' &&
    Array.isArray(update.participants) &&
    update.participants.every((participant) =>
      participant &&
      typeof participant.id === 'string' &&
      typeof participant.name === 'string'
    )
  );
};

const getBase64ByteLength = (data: string) => {
  if (
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  ) {
    return null;
  }

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
};

const isSharedUpdate = (value: unknown): value is SharedUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;

  if (update.type === 'text') {
    return typeof update.text === 'string' && new TextEncoder().encode(update.text).length <= MAX_TEXT_BYTES;
  }

  if (update.type === 'image' && typeof update.mimeType === 'string' && typeof update.data === 'string') {
    const byteLength = getBase64ByteLength(update.data);
    return SUPPORTED_IMAGE_TYPES.has(update.mimeType) && byteLength !== null && byteLength <= MAX_IMAGE_BYTES;
  }

  return false;
};

const fileToBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
};

const App = () => {
  const [sharedItem, setSharedItem] = useState<SharedUpdate>({ type: 'text', text: '' });
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [notice, setNotice] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [deviceName, setDeviceName] = useState(getStoredDeviceName);
  const [nameDraft, setNameDraft] = useState(getStoredDeviceName);
  const [deviceId, setDeviceId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const draftBytes = new TextEncoder().encode(draft).length;
  const sharedText = sharedItem.type === 'text' ? sharedItem.text : '';
  const sharedImage = sharedItem.type === 'image' ? sharedItem : null;
  const hasSharedItem = Boolean(sharedText || sharedImage);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout>;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        setConnection('connected');
        const savedName = getStoredDeviceName();
        if (savedName) socket.send(JSON.stringify({ type: 'set-name', name: savedName }));
      };
      socket.onmessage = (event) => {
        try {
          const update: unknown = JSON.parse(event.data);
          if (isParticipantUpdate(update)) {
            setDeviceId(update.deviceId);
            setParticipants(update.participants);
            return;
          }
          if (!isSharedUpdate(update)) throw new Error('Invalid shared update');
          setSharedItem(update);
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

  const shareText = (text: string) => {
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      setNotice('Text is too large to share.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Disconnected. Your draft is still here.');
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'text', text }));
    setSharedItem({ type: 'text', text });
    setNotice('Shared with connected devices.');
  };

  const saveDeviceName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameDraft.trim();
    const hasControlCharacter = name.split('').some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    if (!name || name.length > 32 || hasControlCharacter) {
      setNotice('Enter a device name between 1 and 32 characters.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Disconnected. Your device name was not updated.');
      return;
    }

    socketRef.current.send(JSON.stringify({ type: 'set-name', name }));
    setDeviceName(name);
    setNameDraft(name);
    try {
      window.localStorage.setItem('phonble-device-name', name);
    } catch {
      setNotice('Name updated for this connection, but could not be saved in this browser.');
      return;
    }
    setNotice('Device name updated.');
  };

  const shareImage = async (file: File) => {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setNotice('Choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setNotice('Image is too large. Maximum size is 5 MB.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Disconnected. Your image was not shared.');
      return;
    }

    try {
      const data = await fileToBase64(file);
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        setNotice('Disconnected. Your image was not shared.');
        return;
      }
      const update = { type: 'image', mimeType: file.type, data } satisfies SharedUpdate;
      socketRef.current.send(JSON.stringify(update));
      setSharedItem(update);
      setNotice('Shared with connected devices.');
    } catch {
      setNotice('Could not read this image.');
    }
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === 'file');
    if (imageItem) {
      event.preventDefault();
      const image = imageItem.getAsFile();
      if (image) void shareImage(image);
      else setNotice('Could not read this image.');
      return;
    }

    event.preventDefault();
    const input = event.currentTarget;
    const text = draft.slice(0, input.selectionStart) + event.clipboardData.getData('text/plain') + draft.slice(input.selectionEnd);
    setDraft(text);
    shareText(text);
  };

  const dropImage = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const image = event.dataTransfer.files[0];
    if (image) void shareImage(image);
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
          <span className="workspace-type">TEXT + IMAGE</span>
        </div>

        <section className="presence" aria-label="Connected devices">
          <form className="device-name-form" onSubmit={saveDeviceName}>
            <label className="device-name-field" htmlFor="device-name">
              <span className="eyebrow">This device</span>
              <input
                id="device-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Name this device"
                maxLength={32}
                autoComplete="off"
              />
            </label>
            <button className="file-button" type="submit" disabled={connection !== 'connected' || nameDraft.trim() === deviceName}>
              Save name
            </button>
          </form>
          <div className="participants" aria-live="polite">
            <div className="participants-heading">
              <Users size={17} aria-hidden="true" />
              <span>Connected</span>
              <span className="participant-count">{participants.length}</span>
            </div>
            {participants.length ? (
              <ul className="participant-list">
                {participants.map((participant) => (
                  <li className="participant" key={participant.id}>
                    <span className="participant-indicator" aria-hidden="true" />
                    <span>{participant.name}</span>
                    {participant.id === deviceId ? <span className="self-label">(you)</span> : null}
                  </li>
                ))}
              </ul>
            ) : <span className="participant-empty">Waiting for devices</span>}
          </div>
        </section>

        <div className="panes">
          <section className="pane incoming" aria-labelledby="incoming-heading">
            <div className="pane-heading">
              <div><p className="eyebrow">01 / From your devices</p><h2 id="incoming-heading">Latest share</h2></div>
              <div className="pane-actions">
                <button className="icon-button" title="Copy shared text" aria-label="Copy shared text" onClick={copy} disabled={!sharedText}>
                  <Copy size={18} />
                </button>
                <button className="icon-button" title="Clear shared item" aria-label="Clear shared item" onClick={() => shareText('')} disabled={!hasSharedItem || connection !== 'connected'}>
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            {sharedImage ? (
              <figure className="shared-image">
                <img src={`data:${sharedImage.mimeType};base64,${sharedImage.data}`} alt="Shared image" />
                <a className="download-button" href={`data:${sharedImage.mimeType};base64,${sharedImage.data}`} download={`shared-image.${IMAGE_EXTENSIONS[sharedImage.mimeType]}`}>
                  <Download size={17} /> Download image
                </a>
              </figure>
            ) : sharedText ? <pre className="shared-text">{sharedText}</pre> : (
              <div className="empty-state"><Clipboard size={28} strokeWidth={1.5} /><p>Nothing shared yet.</p></div>
            )}
          </section>

          <section className="pane outgoing" aria-labelledby="outgoing-heading">
            <div className="pane-heading">
              <div><p className="eyebrow">02 / From this device</p><h2 id="outgoing-heading">Send text or image</h2></div>
              <span className="pane-symbol" aria-hidden="true"><Send size={20} /></span>
            </div>
            <label className="sr-only" htmlFor="draft">Text to share</label>
            <div
              className={`compose-area${dragActive ? ' drag-active' : ''}`}
              aria-label="Image drop area"
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={dropImage}
            >
              <textarea id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={paste} placeholder="Type text, or paste/drop an image..." spellCheck={false} />
            </div>
            <input
              id="image-file"
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label="Choose image"
              onChange={(event) => {
                const image = event.currentTarget.files?.[0];
                if (image) void shareImage(image);
                event.currentTarget.value = '';
              }}
            />
            <div className="compose-footer">
              <span className={draftBytes > MAX_TEXT_BYTES ? 'over-limit' : ''}>{(draftBytes / 1024).toFixed(1)} / 60 KB</span>
              <div className="compose-actions">
                <button className="file-button" onClick={() => document.getElementById('image-file')?.click()} disabled={connection !== 'connected'}>
                  <ImagePlus size={17} /> Choose image
                </button>
                <button className="share-button" onClick={() => shareText(draft)} disabled={!draft || draftBytes > MAX_TEXT_BYTES || connection !== 'connected'}>
                  <Send size={17} /> Share text
                </button>
              </div>
            </div>
          </section>
        </div>
        <div className="footnote" aria-live="polite">{notice || 'One shared clipboard across connected devices.'}</div>
      </section>
    </main>
  );
};

export default App;
