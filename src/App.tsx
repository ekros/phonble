import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, DragEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Clipboard, Copy, Download, ImagePlus, MoveDiagonal2, MousePointerClick, Search, Send, Trash2, Users, Wifi, WifiOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import PointerCursor from './PointerCursor';
import {
  canVibrate,
  getHandoffDirection,
  HANDOFF_ENTER_PATTERN,
  HANDOFF_LEAVE_PATTERN,
  needsUserGesture,
  vibrate,
} from './haptics';
import { createPointerMessage, createPointerReleaseMessage, isPointerUpdate, toPhonePoint } from './pointerSync';
import {
  applyRemoteInput,
  createClickInput,
  createScrollInput,
  isApplyingRemoteInput,
  isRemoteInputUpdate,
} from './remoteInput';
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
type HistoryItem = SharedUpdate & { id: string; deviceName: string; timestamp: number };
type Participant = { id: string; name: string };
type ParticipantUpdate = { type: 'participants'; deviceId: string; participants: Participant[] };
type HistoryUpdate = { type: 'history'; items: HistoryItem[] };
type HistoryItemUpdate = { type: 'history-item'; item: HistoryItem; removedIds: string[] };
type SessionUpdate =
  | { type: 'session'; sessionId: string }
  | { type: 'session-error'; message: string }
  | { type: 'session-left' };
type ServerInfoUpdate = { type: 'server-info'; lanAddresses: string[] };

const SESSION_STORAGE_KEY = 'phonble-session-id';
const PHONE_WIDTH_STORAGE_KEY = 'phonble-phone-width';
const HANDOFF_VIBRATION_STORAGE_KEY = 'phonble-handoff-vibration';
const SESSION_ID_PATTERN = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;
const DEFAULT_PHONE_WIDTH = 280;
const MIN_PHONE_WIDTH = 200;
const MAX_PHONE_WIDTH = 360;
const REMOTE_CONTROL_IDLE_MS = 5000;

const clampPhoneWidth = (width: number) => Math.min(MAX_PHONE_WIDTH, Math.max(MIN_PHONE_WIDTH, width));

const getStoredPhoneWidth = () => {
  try {
    const storedWidth = window.localStorage.getItem(PHONE_WIDTH_STORAGE_KEY);
    if (!storedWidth) return DEFAULT_PHONE_WIDTH;
    const width = Number(storedWidth);
    return Number.isFinite(width) ? clampPhoneWidth(width) : DEFAULT_PHONE_WIDTH;
  } catch {
    return DEFAULT_PHONE_WIDTH;
  }
};

const getStoredHandoffVibrationEnabled = () => {
  try {
    return window.localStorage.getItem(HANDOFF_VIBRATION_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const createSessionJoinUrl = (sessionId: string, hostname: string) => {
  const url = new URL(window.location.origin);
  if (hostname !== url.hostname) url.hostname = hostname;
  url.searchParams.set('session', sessionId);
  return url.toString();
};

const isLoopbackHostname = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '::1' ||
  hostname === '[::1]' ||
  hostname === '0.0.0.0' ||
  hostname.startsWith('127.');

export const getJoinHostname = (lanAddresses: string[]) => {
  const hostname = window.location.hostname;
  return isLoopbackHostname(hostname) ? lanAddresses[0] ?? hostname : hostname;
};

const formatSessionIdInput = (value: string) => {
  const characters = value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (characters.length <= 3) return characters;
  if (characters.length <= 7) return `${characters.slice(0, 3)}-${characters.slice(3)}`;
  return `${characters.slice(0, 3)}-${characters.slice(3, 7)}-${characters.slice(7)}`;
};

const getStoredDeviceName = () => {
  try {
    return window.localStorage.getItem('phonble-device-name') ?? '';
  } catch {
    return '';
  }
};

const getStoredSessionId = () => {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY) ?? '';
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

const isSessionUpdate = (value: unknown): value is SessionUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  if (update.type === 'session') return typeof update.sessionId === 'string';
  if (update.type === 'session-error') return typeof update.message === 'string';
  return update.type === 'session-left';
};

const isServerInfoUpdate = (value: unknown): value is ServerInfoUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    update.type === 'server-info' &&
    Array.isArray(update.lanAddresses) &&
    update.lanAddresses.every((address) => typeof address === 'string')
  );
};

const isHistoryItem = (value: unknown): value is HistoryItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.deviceName === 'string' &&
    typeof item.timestamp === 'number' &&
    Number.isFinite(item.timestamp) &&
    isSharedUpdate(value)
  );
};

const isHistoryUpdate = (value: unknown): value is HistoryUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return update.type === 'history' && Array.isArray(update.items) && update.items.length <= 20 && update.items.every(isHistoryItem);
};

const isHistoryItemUpdate = (value: unknown): value is HistoryItemUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    update.type === 'history-item' &&
    isHistoryItem(update.item) &&
    Array.isArray(update.removedIds) &&
    update.removedIds.every((id) => typeof id === 'string')
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
  const [sessionId, setSessionId] = useState('');
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [sessionDraft, setSessionDraft] = useState('');
  const [sessionPending, setSessionPending] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [phoneWidth, setPhoneWidth] = useState(getStoredPhoneWidth);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [pointerOnPhone, setPointerOnPhone] = useState(false);
  const [remotePointer, setRemotePointer] = useState<{ x: number; y: number; deviceId: string } | null>(null);
  const [handoffVibration, setHandoffVibration] = useState(getStoredHandoffVibrationEnabled);
  const [hapticsSupported] = useState(canVibrate);
  const [hapticsArmed, setHapticsArmed] = useState(() => !needsUserGesture());
  const [remoteControl, setRemoteControl] = useState<{ deviceId: string; name: string; muted: boolean } | null>(null);
  const [remoteClick, setRemoteClick] = useState<{ id: number; x: number; y: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const joiningStoredSessionRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const phoneAreaRef = useRef<HTMLElement | null>(null);
  const pointerSyncActiveRef = useRef(false);
  const remoteControlRef = useRef<{ deviceId: string; name: string; muted: boolean } | null>(null);
  const remoteControlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteClickSequenceRef = useRef(0);
  const participantsRef = useRef<Participant[]>([]);
  const remotePointerRef = useRef<{ deviceId: string; active: boolean } | null>(null);
  const handoffVibrationRef = useRef(handoffVibration);
  const draftBytes = new TextEncoder().encode(draft).length;
  const sharedText = sharedItem.type === 'text' ? sharedItem.text : '';
  const sharedImage = sharedItem.type === 'image' ? sharedItem : null;
  const hasSharedItem = Boolean(sharedText || sharedImage);
  const phoneJoinHostname = getJoinHostname(lanAddresses);
  const phoneJoinUrl = sessionId ? createSessionJoinUrl(sessionId, phoneJoinHostname) : '';
  const phoneJoinUrlIsLocal = isLoopbackHostname(phoneJoinHostname);
  const hasOtherParticipant = participants.some((participant) => participant.id !== deviceId);
  const canSyncPointer = connection === 'connected' && Boolean(sessionId) && hasOtherParticipant;
  const visibleRemotePointer =
    remotePointer && participants.some((participant) => participant.id === remotePointer.deviceId)
      ? remotePointer
      : null;

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    pointerSyncActiveRef.current = canSyncPointer && pointerOnPhone;
  }, [canSyncPointer, pointerOnPhone]);

  useEffect(() => {
    handoffVibrationRef.current = handoffVibration;
  }, [handoffVibration]);

  useEffect(() => {
    if (hapticsArmed) return;
    const arm = () => setHapticsArmed(true);
    const options = { once: true };
    window.addEventListener('pointerdown', arm, options);
    window.addEventListener('keydown', arm, options);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [hapticsArmed]);

  useEffect(() => {
    const area = phoneAreaRef.current;
    if (!area) return;
    let frame = 0;
    let pendingDelta = 0;
    let pendingPoint: { x: number; y: number } | null = null;

    const flushScroll = () => {
      frame = 0;
      const point = pendingPoint;
      const dy = pendingDelta;
      pendingDelta = 0;
      const socket = socketRef.current;
      if (!point || !dy || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(createScrollInput(point.x, point.y, dy)));
    };

    const handleWheel = (event: WheelEvent) => {
      if (!pointerSyncActiveRef.current || !event.deltaY) return;
      const point = toPhonePoint(area.getBoundingClientRect(), event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      pendingPoint = point;
      pendingDelta += event.deltaY * step;
      if (!frame) frame = window.requestAnimationFrame(flushScroll);
    };

    area.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      area.removeEventListener('wheel', handleWheel);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const updatePhoneWidth = (width: number) => {
    const nextWidth = clampPhoneWidth(width);
    setPhoneWidth(nextWidth);
    try {
      window.localStorage.setItem(PHONE_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // The target remains resizable for this page load.
    }
  };

  const updateHandoffVibration = (enabled: boolean) => {
    setHandoffVibration(enabled);
    setHapticsArmed(true);
    vibrate(enabled ? HANDOFF_ENTER_PATTERN : 0);
    try {
      window.localStorage.setItem(HANDOFF_VIBRATION_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // The setting stays active for this page load.
    }
  };

  const resizePhoneWithKeyboard = (key: string) => {
    if (key === 'ArrowRight' || key === 'ArrowUp') updatePhoneWidth(phoneWidth + 10);
    else if (key === 'ArrowLeft' || key === 'ArrowDown') updatePhoneWidth(phoneWidth - 10);
    else if (key === 'Home') updatePhoneWidth(MIN_PHONE_WIDTH);
    else if (key === 'End') updatePhoneWidth(MAX_PHONE_WIDTH);
    else return false;
    return true;
  };

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout>;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    const clearRemoteControl = () => {
      if (remoteControlTimerRef.current) {
        clearTimeout(remoteControlTimerRef.current);
        remoteControlTimerRef.current = null;
      }
      if (remoteControlRef.current) {
        remoteControlRef.current = null;
        setRemoteControl(null);
      }
    };

    const connect = () => {
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        setConnection('connected');
        const savedName = getStoredDeviceName();
        if (savedName) socket.send(JSON.stringify({ type: 'set-name', name: savedName }));
        const requestedSessionId = new URLSearchParams(window.location.search).get('session') ?? '';
        const hasRequestedSession = SESSION_ID_PATTERN.test(requestedSessionId);
        const savedSessionId = getStoredSessionId();
        const sessionToJoin = hasRequestedSession ? requestedSessionId : savedSessionId;
        if (SESSION_ID_PATTERN.test(sessionToJoin)) {
          joiningStoredSessionRef.current = !hasRequestedSession;
          setSessionPending(true);
          socket.send(JSON.stringify({ type: 'join-session', sessionId: sessionToJoin }));
        }
      };
      socket.onmessage = (event) => {
        try {
          const update: unknown = JSON.parse(event.data);
          if (isSessionUpdate(update)) {
            clearRemoteControl();
            remotePointerRef.current = null;
            if (update.type === 'session') {
              joiningStoredSessionRef.current = false;
              setSessionId(update.sessionId);
              setSessionDraft('');
              setSessionPending(false);
              setDeviceId('');
              setParticipants([]);
              setHistory([]);
              setSharedItem({ type: 'text', text: '' });
              try {
                window.localStorage.setItem(SESSION_STORAGE_KEY, update.sessionId);
              } catch {
                setNotice('Session joined, but could not be saved in this browser.');
              }
            } else if (update.type === 'session-error') {
              const wasJoiningStoredSession = joiningStoredSessionRef.current;
              joiningStoredSessionRef.current = false;
              setSessionPending(false);
              setNotice(update.message);
              if (wasJoiningStoredSession) {
                try {
                  window.localStorage.removeItem(SESSION_STORAGE_KEY);
                } catch {
                  // Session state remains available for this connection.
                }
              }
            } else {
              setSessionId('');
              setSessionPending(false);
              setParticipants([]);
              setDeviceId('');
              setHistory([]);
              setSharedItem({ type: 'text', text: '' });
              try {
                window.localStorage.removeItem(SESSION_STORAGE_KEY);
              } catch {
                // Session state remains available for this connection.
              }
            }
            return;
          }
          if (isParticipantUpdate(update)) {
            setDeviceId(update.deviceId);
            participantsRef.current = update.participants;
            setParticipants(update.participants);
            return;
          }
          if (isHistoryUpdate(update)) {
            setHistory(update.items);
            return;
          }
          if (isHistoryItemUpdate(update)) {
            setHistory((items) => [
              update.item,
              ...items.filter((item) => item.id !== update.item.id && !update.removedIds.includes(item.id)),
            ]);
            return;
          }
          if (isServerInfoUpdate(update)) {
            setLanAddresses(update.lanAddresses);
            return;
          }
          if (isPointerUpdate(update)) {
            const handoff = getHandoffDirection(remotePointerRef.current, update);
            remotePointerRef.current = { deviceId: update.deviceId, active: update.active };
            setRemotePointer(update.active ? { x: update.x, y: update.y, deviceId: update.deviceId } : null);
            if (handoff && handoffVibrationRef.current) {
              vibrate(handoff === 'enter' ? HANDOFF_ENTER_PATTERN : HANDOFF_LEAVE_PATTERN);
            }
            if (!update.active && remoteControlRef.current?.deviceId === update.deviceId) clearRemoteControl();
            return;
          }
          if (isRemoteInputUpdate(update)) {
            const name = participantsRef.current.find((participant) => participant.id === update.deviceId)?.name ?? 'another device';
            const current = remoteControlRef.current;
            const muted = current?.deviceId === update.deviceId ? current.muted : false;
            if (!current || current.deviceId !== update.deviceId || current.name !== name || current.muted !== muted) {
              const next = { deviceId: update.deviceId, name, muted };
              remoteControlRef.current = next;
              setRemoteControl(next);
            }
            if (remoteControlTimerRef.current) clearTimeout(remoteControlTimerRef.current);
            remoteControlTimerRef.current = setTimeout(clearRemoteControl, REMOTE_CONTROL_IDLE_MS);
            if (!muted) applyRemoteInput(update);
            if (!muted && update.kind === 'click') {
              remoteClickSequenceRef.current += 1;
              setRemoteClick({ id: remoteClickSequenceRef.current, x: update.x, y: update.y });
              if (remoteClickTimerRef.current) clearTimeout(remoteClickTimerRef.current);
              remoteClickTimerRef.current = setTimeout(() => {
                remoteClickTimerRef.current = null;
                setRemoteClick(null);
              }, 480);
            }
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
        clearRemoteControl();
        remotePointerRef.current = null;
        setSessionPending(false);
        setSessionId('');
        setParticipants([]);
        setDeviceId('');
        setHistory([]);
        setSharedItem({ type: 'text', text: '' });
        setConnection('reconnecting');
        retryTimer = setTimeout(connect, 1500);
      };
    };

    retryTimer = setTimeout(connect, 0);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      if (remoteControlTimerRef.current) clearTimeout(remoteControlTimerRef.current);
      if (remoteClickTimerRef.current) clearTimeout(remoteClickTimerRef.current);
      socketRef.current?.close();
    };
  }, []);

  const movePointerToPhone = (event: ReactPointerEvent<HTMLElement>) => {
    const point = toPhonePoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    const lastPointer = lastPointerRef.current;
    if (lastPointer?.x === point.x && lastPointer.y === point.y) return;
    lastPointerRef.current = point;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(createPointerMessage(point.x, point.y)));
    }
  };

  const startPointerSync = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canSyncPointer) return;
    setPointerOnPhone(true);
    movePointerToPhone(event);
  };

  const forwardClickToPhone = (event: ReactPointerEvent<HTMLElement>) => {
    if (isApplyingRemoteInput() || !pointerOnPhone || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.phone-resize-handle')) return;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const point = toPhonePoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    socket.send(JSON.stringify(createClickInput(point.x, point.y)));
  };

  const stopPointerSync = () => {
    if (!pointerOnPhone) return;
    setPointerOnPhone(false);
    lastPointerRef.current = null;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(createPointerReleaseMessage()));
    }
  };

  useEffect(() => {
    if (canSyncPointer || !pointerOnPhone) return;
    setPointerOnPhone(false);
    lastPointerRef.current = null;
  }, [canSyncPointer, pointerOnPhone]);

  const shareText = (text: string) => {
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      setNotice('Text is too large to share.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Disconnected. Your draft is still here.');
      return;
    }
    if (!sessionId || sessionPending) {
      setNotice('Create or join a session to share text.');
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'text', text }));
    setSharedItem({ type: 'text', text });
    setNotice('Shared with connected devices.');
  };

  const createSession = () => {
    if (socketRef.current?.readyState !== WebSocket.OPEN || sessionPending) return;
    joiningStoredSessionRef.current = false;
    setSessionPending(true);
    socketRef.current.send(JSON.stringify({ type: 'create-session' }));
  };

  const joinSession = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = sessionDraft.trim().toLowerCase();
    if (!SESSION_ID_PATTERN.test(id)) {
      setNotice('Enter a session ID in the format abc-defg-hij.');
      return;
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN || sessionPending) return;
    joiningStoredSessionRef.current = false;
    setSessionPending(true);
    socketRef.current.send(JSON.stringify({ type: 'join-session', sessionId: id }));
  };

  const leaveSession = () => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'leave-session' }));
  };

  const copySessionId = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(sessionId);
      setNotice('Session ID copied.');
    } catch {
      setNotice('Could not copy the session ID.');
    }
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
    if (!sessionId || sessionPending) {
      setNotice('Create or join a session to share images.');
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

  const copyHistoryItem = async (item: HistoryItem) => {
    try {
      if (item.type === 'text') {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(item.text);
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
          throw new Error('Image clipboard API unavailable');
        }
        const source = await (await fetch(`data:${item.mimeType};base64,${item.data}`)).blob();
        let png = source;
        if (item.mimeType !== 'image/png') {
          const bitmap = await createImageBitmap(source);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas unavailable');
            context.drawImage(bitmap, 0, 0);
            png = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed')), 'image/png');
            });
          } finally {
            bitmap.close();
          }
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      }
      setNotice('Copied previous share to clipboard.');
    } catch {
      setNotice(item.type === 'image' ? 'Could not copy image. Download it from history instead.' : 'Could not copy this share.');
    }
  };

  const filteredHistory = history.filter((item) => {
    const search = historySearch.trim().toLocaleLowerCase();
    if (!search) return true;
    const content = item.type === 'text' ? item.text : `image ${item.mimeType}`;
    return `${content} ${item.deviceName}`.toLocaleLowerCase().includes(search);
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span>phonble</span></div>
        <div className={`connection ${connection}`} role="status">
          {connection === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span>
        </div>
      </header>

      <div
        className="app-layout"
        style={{
          gridTemplateColumns: `minmax(0, 1fr) ${phoneWidth}px`,
          '--phone-height': `${phoneWidth * 2}px`,
        } as CSSProperties}
      >
      <section className="workspace" aria-label="Shared clipboard">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Shared workspace / 01</p>
            <h1>Clipboard</h1>
          </div>
          <span className="workspace-type">TEXT + IMAGE</span>
        </div>

        {remoteControl ? (
          <div className={`remote-control${remoteControl.muted ? ' muted' : ''}`} role="status" aria-live="polite">
            <MousePointerClick size={18} aria-hidden="true" />
            <span>
              {remoteControl.muted
                ? `${remoteControl.name} is pointing at this device; input paused.`
                : `${remoteControl.name} is scrolling and clicking this device.`}
            </span>
            {remoteControl.muted ? (
              <span className="remote-control-state">Paused</span>
            ) : (
              <button
                type="button"
                className="file-button"
                onClick={() => {
                  const current = remoteControlRef.current;
                  if (!current) return;
                  const next = { ...current, muted: true };
                  remoteControlRef.current = next;
                  setRemoteControl(next);
                }}
              >
                Release control
              </button>
            )}
          </div>
        ) : null}

        <section className="session-bar" aria-label="Session">
          {sessionId ? (
            <>
              <div className="active-session">
                <span className="eyebrow">Session ID</span>
                <code>{sessionId}</code>
              </div>
              <div className="session-actions">
                <button className="file-button" type="button" onClick={copySessionId}>
                  <Copy size={16} /> Copy ID
                </button>
                <button className="file-button" type="button" onClick={leaveSession} disabled={connection !== 'connected'}>
                  Leave session
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="session-intro">
                <span className="eyebrow">Private workspace</span>
                <span>Create a session or join with an ID.</span>
              </div>
              <div className="session-actions">
                <button className="share-button" type="button" onClick={createSession} disabled={connection !== 'connected' || sessionPending}>
                  Create session
                </button>
                <form className="join-session-form" onSubmit={joinSession}>
                  <label className="sr-only" htmlFor="session-id">Session ID</label>
                  <input
                    id="session-id"
                    value={sessionDraft}
                    onChange={(event) => setSessionDraft(formatSessionIdInput(event.target.value))}
                    placeholder="abc-defg-hij"
                    maxLength={12}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="file-button" type="submit" disabled={connection !== 'connected' || sessionPending}>
                    Join
                  </button>
                </form>
              </div>
            </>
          )}
        </section>

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
            ) : <span className="participant-empty">{sessionId ? 'Waiting for devices' : 'Create or join a session'}</span>}
            <label
              className={`haptics-toggle${hapticsSupported ? '' : ' unsupported'}`}
              title={hapticsSupported
                ? 'Vibrates this device when another device’s pointer enters or leaves its screen.'
                : 'This browser has no Vibration API, so handoffs stay silent.'}
            >
              <input
                type="checkbox"
                checked={handoffVibration}
                onChange={(event) => updateHandoffVibration(event.target.checked)}
                disabled={!hapticsSupported}
              />
              <span>Vibrate on handoff</span>
            </label>
            {hapticsSupported && !hapticsArmed ? (
              <button
                type="button"
                className="file-button haptics-arm"
                title="Browsers ignore vibration until the page has been tapped once."
                onClick={() => {
                  setHapticsArmed(true);
                  vibrate(HANDOFF_ENTER_PATTERN);
                }}
              >
                Tap to enable vibration
              </button>
            ) : null}
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
                <button className="file-button" onClick={() => document.getElementById('image-file')?.click()} disabled={connection !== 'connected' || !sessionId || sessionPending}>
                  <ImagePlus size={17} /> Choose image
                </button>
                <button className="share-button" onClick={() => shareText(draft)} disabled={!draft || draftBytes > MAX_TEXT_BYTES || connection !== 'connected' || !sessionId || sessionPending}>
                  <Send size={17} /> Share text
                </button>
              </div>
            </div>
          </section>
        </div>
        <section className="history" aria-labelledby="history-heading">
          <div className="history-heading">
            <div>
              <p className="eyebrow">03 / In this session</p>
              <h2 id="history-heading">Clipboard history</h2>
            </div>
            <label className="history-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search clipboard history</span>
              <input
                type="search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search shares or devices"
                disabled={!sessionId}
              />
            </label>
          </div>
          {!sessionId ? (
            <p className="history-empty">Join a session to build a shared history.</p>
          ) : history.length === 0 ? (
            <p className="history-empty">New shares will appear here.</p>
          ) : filteredHistory.length === 0 ? (
            <p className="history-empty">No matching shares.</p>
          ) : (
            <ul className="history-list">
              {filteredHistory.map((item) => (
                <li className="history-entry" key={item.id}>
                  <div className="history-entry-content">
                    {item.type === 'text' ? (
                      <p className="history-preview">{item.text || 'Empty text share'}</p>
                    ) : (
                      <img
                        className="history-thumbnail"
                        src={`data:${item.mimeType};base64,${item.data}`}
                        alt="Shared image preview"
                      />
                    )}
                    <div className="history-meta">
                      <span>{item.deviceName}</span>
                      <time dateTime={new Date(item.timestamp).toISOString()}>
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(item.timestamp)}
                      </time>
                    </div>
                  </div>
                  <div className="history-actions">
                    <button className="file-button" type="button" onClick={() => void copyHistoryItem(item)}>
                      <Copy size={15} /> {item.type === 'text' ? 'Copy' : 'Copy image'}
                    </button>
                    {item.type === 'image' ? (
                      <a
                        className="download-button"
                        href={`data:${item.mimeType};base64,${item.data}`}
                        download={`shared-image-${item.id}.${IMAGE_EXTENSIONS[item.mimeType]}`}
                        aria-label={`Download image shared by ${item.deviceName}`}
                      >
                        <Download size={15} />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="footnote" aria-live="polite">{notice || 'One shared clipboard across connected devices.'}</div>
      </section>
      <aside
        ref={phoneAreaRef}
        className={`phone-target${pointerOnPhone ? ' pointer-sync' : ''}`}
        aria-label="Phone placement area"
        onPointerEnter={startPointerSync}
        onPointerMove={(event) => {
          if (pointerOnPhone) movePointerToPhone(event);
        }}
        onPointerLeave={stopPointerSync}
        onPointerDown={forwardClickToPhone}
      >
        {hasOtherParticipant ? (
          <div className="phone-invite" aria-live="polite">
            <MousePointerClick size={22} aria-hidden="true" />
            <p className="phone-prompt">Move the cursor into this area to interact with the phone.</p>
          </div>
        ) : phoneJoinUrl ? (
          <div className="phone-qr">
            <p className="eyebrow">Scan to join</p>
            <QRCodeSVG value={phoneJoinUrl} size={180} level="M" title={`Join session ${sessionId}`} />
            <code>{sessionId}</code>
            {phoneJoinUrlIsLocal ? (
              <p className="phone-prompt">
                This computer has no network address, so the QR only works on this computer.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="phone-prompt">Create or join a session to connect your phone.</p>
        )}
        <div
          className="phone-resize-handle"
          role="slider"
          aria-label="Phone area width"
          aria-orientation="horizontal"
          aria-valuemin={MIN_PHONE_WIDTH}
          aria-valuemax={MAX_PHONE_WIDTH}
          aria-valuenow={phoneWidth}
          aria-valuetext={`${phoneWidth} pixels wide`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (resizePhoneWithKeyboard(event.key)) event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            resizeStartRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: phoneWidth };
          }}
          onPointerMove={(event) => {
            const resizeStart = resizeStartRef.current;
            if (resizeStart?.pointerId === event.pointerId) {
              updatePhoneWidth(resizeStart.startWidth + event.clientX - resizeStart.startX);
            }
          }}
          onPointerUp={(event) => {
            if (resizeStartRef.current?.pointerId === event.pointerId) resizeStartRef.current = null;
          }}
          onPointerCancel={() => {
            resizeStartRef.current = null;
          }}
        >
          <MoveDiagonal2 size={15} aria-hidden="true" />
        </div>
      </aside>
      </div>
      {visibleRemotePointer ? (
        <PointerCursor x={visibleRemotePointer.x} y={visibleRemotePointer.y} />
      ) : null}
      {remoteClick ? (
        <div
          key={remoteClick.id}
          className="pointer-click"
          style={{ left: `${remoteClick.x * 100}%`, top: `${remoteClick.y * 100}%` }}
          data-testid="remote-click"
          aria-hidden="true"
        />
      ) : null}
    </main>
  );
};

export default App;
