import { afterEach, expect, test } from '@rstest/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { createSessionJoinUrl, getJoinHostname } from '../src/App';
import { HANDOFF_ENTER_PATTERN, HANDOFF_LEAVE_PATTERN } from '../src/haptics';

class MockWebSocket {
  static OPEN = 1;
  static lastInstance: MockWebSocket | null = null;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    MockWebSocket.lastInstance = this;
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(update: unknown) {
    this.onmessage?.({ data: JSON.stringify(update) });
  }
}

const originalWebSocket = globalThis.WebSocket;

const renderConnected = async () => {
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
  });
};

const pointerMessages = () =>
  (MockWebSocket.lastInstance?.sent ?? [])
    .map((message) => JSON.parse(message) as { type: string })
    .filter((update) => update.type === 'pointer');

const lastPointerMessage = () => pointerMessages().slice(-1)[0];

const inputMessages = () =>
  (MockWebSocket.lastInstance?.sent ?? [])
    .map((message) => JSON.parse(message) as { type: string })
    .filter((update) => update.type === 'input');

const vibrationCalls: (number | number[])[] = [];

const stubVibration = () => {
  vibrationCalls.length = 0;
  Object.defineProperty(window.navigator, 'vibrate', {
    configurable: true,
    value: (pattern: number | number[]) => {
      vibrationCalls.push(pattern);
      return true;
    },
  });
};

const renderWithOtherDevice = async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'phone',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
  });
};

afterEach(() => {
  cleanup();
  MockWebSocket.lastInstance = null;
  vibrationCalls.length = 0;
  window.localStorage.clear();
  window.happyDOM.setURL('http://localhost:3000/');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
  delete (window.navigator as { vibrate?: unknown }).vibrate;
  delete (window.navigator as { userActivation?: unknown }).userActivation;
});

test('renders a received image with a download link', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  act(() => MockWebSocket.lastInstance?.receive({ type: 'image', mimeType: 'image/png', data: 'AQID' }));

  expect(screen.getByRole('img', { name: 'Shared image' })).toHaveAttribute('src', 'data:image/png;base64,AQID');
  expect(screen.getByRole('link', { name: 'Download image' })).toHaveAttribute('download', 'shared-image.png');
});

test('creates a session and joins an existing session by ID', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => MockWebSocket.lastInstance?.open());

  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'create-session' }));

  act(() => MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' }));
  expect(within(screen.getByLabelText('Session')).getByText('abc-defg-hij')).toBeInTheDocument();
  expect(window.localStorage.getItem('phonble-session-id')).toBe('abc-defg-hij');

  fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
  act(() => MockWebSocket.lastInstance?.receive({ type: 'session-left' }));
  fireEvent.change(screen.getByLabelText('Session ID'), { target: { value: 'phone00001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join' }));
  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'join-session', sessionId: 'pho-ne00-001' }));
});

test('joins the session from the URL before a saved session', async () => {
  window.localStorage.setItem('phonble-session-id', 'old-defg-hij');
  window.history.replaceState({}, '', '/?session=abc-defg-hij');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());

  act(() => MockWebSocket.lastInstance?.open());

  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'join-session', sessionId: 'abc-defg-hij' }));
  expect(MockWebSocket.lastInstance?.sent).not.toContain(JSON.stringify({ type: 'join-session', sessionId: 'old-defg-hij' }));
});

test('shows a join QR when the session is opened from a LAN address', async () => {
  window.happyDOM.setURL('http://192.168.1.25:3000/');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  expect(screen.getByTitle('Join session abc-defg-hij')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Phone placement area')).getByText('abc-defg-hij')).toBeInTheDocument();
});

test('shows the join QR with the network address on a localhost session', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'server-info', lanAddresses: ['192.168.1.25'] });
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
  });

  expect(getJoinHostname(['192.168.1.25'])).toBe('192.168.1.25');
  expect(createSessionJoinUrl('abc-defg-hij', '192.168.1.25')).toBe('http://192.168.1.25:3000/?session=abc-defg-hij');
  expect(screen.getByTitle('Join session abc-defg-hij')).toBeInTheDocument();
  expect(screen.queryByText('This computer has no network address, so the QR only works on this computer.')).not.toBeInTheDocument();
});

test('falls back to the localhost QR when no network address is reported', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  expect(screen.getByTitle('Join session abc-defg-hij')).toBeInTheDocument();
  expect(
    screen.getByText('This computer has no network address, so the QR only works on this computer.'),
  ).toBeInTheDocument();
});

test('shows a prompt before a session is active', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);

  expect(screen.getByText('Create or join a session to connect your phone.')).toBeInTheDocument();
});

test('shows the pointer shared by another device', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  const { container } = render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
  });

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'phone', active: true, x: 0.25, y: 0.6 }));
  expect(container.querySelector('.pointer-cursor')).toHaveStyle({ left: '25%', top: '60%' });

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'phone', active: false, x: 0, y: 0 }));
  expect(container.querySelector('.pointer-cursor')).toBeNull();
});

test('hides a shared pointer when its device disconnects', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  const { container } = render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
    MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'phone', active: true, x: 0.5, y: 0.5 });
  });
  expect(container.querySelector('.pointer-cursor')).not.toBeNull();

  act(() => MockWebSocket.lastInstance?.receive({
    type: 'participants',
    deviceId: 'laptop',
    participants: [{ id: 'laptop', name: 'Laptop' }],
  }));

  expect(container.querySelector('.pointer-cursor')).toBeNull();
});

test('moves the pointer to the phone while it is over the phone area', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
  });

  const area = screen.getByLabelText('Phone placement area');
  area.getBoundingClientRect = () => ({
    left: 100,
    top: 40,
    width: 200,
    height: 400,
    right: 300,
    bottom: 440,
    x: 100,
    y: 40,
    toJSON: () => ({}),
  });

  fireEvent.pointerOver(area, { clientX: 150, clientY: 140 });
  expect(pointerMessages()).toEqual([{ type: 'pointer', active: true, x: 0.25, y: 0.25 }]);
  expect(area).toHaveClass('pointer-sync');

  fireEvent.pointerMove(area, { clientX: 200, clientY: 240 });
  expect(lastPointerMessage()).toEqual({ type: 'pointer', active: true, x: 0.5, y: 0.5 });

  fireEvent.pointerOut(area, { relatedTarget: document.body });
  expect(lastPointerMessage()).toEqual({ type: 'pointer', active: false, x: 0, y: 0 });
  expect(area).not.toHaveClass('pointer-sync');
});

test('keeps the pointer on this device when it is alone in the session', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }],
    });
  });

  const area = screen.getByLabelText('Phone placement area');
  area.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 200,
    height: 400,
    right: 200,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  fireEvent.pointerOver(area, { clientX: 100, clientY: 200 });
  fireEvent.pointerMove(area, { clientX: 120, clientY: 220 });

  expect(pointerMessages()).toEqual([]);
  expect(area).not.toHaveClass('pointer-sync');
});

test('replaces the join QR with a pointer invitation once the phone connects', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  const { container } = render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }],
    });
  });

  expect(container.querySelector('.phone-qr')).not.toBeNull();
  expect(screen.getByText('Scan to join')).toBeTruthy();

  act(() => MockWebSocket.lastInstance?.receive({
    type: 'participants',
    deviceId: 'laptop',
    participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
  }));

  expect(container.querySelector('.phone-qr')).toBeNull();
  expect(screen.queryByText('Scan to join')).toBeNull();
  expect(
    within(screen.getByLabelText('Phone placement area'))
      .getByText('Move the cursor into this area to interact with the phone.'),
  ).toBeTruthy();
});

test('forwards clicks made inside the phone area to the other devices', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'laptop',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
  });

  const area = screen.getByLabelText('Phone placement area');
  area.getBoundingClientRect = () => ({
    left: 100,
    top: 40,
    width: 200,
    height: 400,
    right: 300,
    bottom: 440,
    x: 100,
    y: 40,
    toJSON: () => ({}),
  });

  fireEvent.pointerOver(area, { clientX: 150, clientY: 140 });
  fireEvent.pointerDown(area, { clientX: 200, clientY: 240, button: 0 });

  expect(inputMessages()).toEqual([{ type: 'input', kind: 'click', x: 0.5, y: 0.5 }]);

  fireEvent.pointerDown(area, { clientX: 250, clientY: 340, button: 2 });
  expect(inputMessages()).toHaveLength(1);
});

test('applies remote input and lets this device pause it', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  const target = document.createElement('button');
  document.body.append(target);
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => target;
  let clicks = 0;
  target.addEventListener('click', () => {
    clicks += 1;
  });

  try {
    render(<App />);
    await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
    act(() => {
      MockWebSocket.lastInstance?.open();
      MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
      MockWebSocket.lastInstance?.receive({
        type: 'participants',
        deviceId: 'phone',
        participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
      });
      MockWebSocket.lastInstance?.receive({ type: 'input', deviceId: 'laptop', kind: 'click', x: 0.5, y: 0.4 });
    });

    expect(clicks).toBe(1);
    expect(screen.getByText('Laptop is scrolling and clicking this device.')).toBeTruthy();
    expect(screen.getByTestId('remote-click')).toHaveStyle({ left: '50%', top: '40%' });

    fireEvent.click(screen.getByRole('button', { name: 'Release control' }));
    act(() => {
      MockWebSocket.lastInstance?.receive({ type: 'input', deviceId: 'laptop', kind: 'click', x: 0.5, y: 0.4 });
    });

    expect(clicks).toBe(1);
    expect(screen.getByText('Paused')).toBeTruthy();
  } finally {
    document.elementFromPoint = originalElementFromPoint;
    target.remove();
  }
});

test('remote clicks activate buttons rendered by the app', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  render(<App />);
  await waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull());
  act(() => {
    MockWebSocket.lastInstance?.open();
    MockWebSocket.lastInstance?.receive({ type: 'session', sessionId: 'abc-defg-hij' });
    MockWebSocket.lastInstance?.receive({
      type: 'participants',
      deviceId: 'phone',
      participants: [{ id: 'laptop', name: 'Laptop' }, { id: 'phone', name: 'Phone' }],
    });
  });

  const copyId = screen.getByRole('button', { name: /Copy ID/ });
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => copyId;
  try {
    act(() => {
      MockWebSocket.lastInstance?.receive({ type: 'input', deviceId: 'laptop', kind: 'click', x: 0.3, y: 0.2 });
    });
    await waitFor(() => expect(screen.getByText(/Session ID copied|Could not copy the session ID/)).toBeTruthy());
  } finally {
    document.elementFromPoint = originalElementFromPoint;
  }
});

test('resizes the phone target with the keyboard and persists its width', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  const { unmount } = render(<App />);
  const resizeControl = screen.getByRole('slider', { name: 'Phone area width' });
  const layout = resizeControl.closest('.app-layout');

  expect(resizeControl).toHaveAttribute('aria-valuenow', '280');
  expect(layout).toHaveStyle({ '--phone-height': '560px' });
  fireEvent.keyDown(resizeControl, { key: 'ArrowRight' });

  expect(resizeControl).toHaveAttribute('aria-valuenow', '290');
  expect(layout).toHaveStyle({ '--phone-height': '580px' });
  expect(window.localStorage.getItem('phonble-phone-width')).toBe('290');
  unmount();
  render(<App />);

  expect(screen.getByRole('slider', { name: 'Phone area width' })).toHaveAttribute('aria-valuenow', '290');
});

test('sends an image selected with the file picker', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();
  const image = new File([new Uint8Array([1, 2, 3])], 'sample.png', { type: 'image/png' });

  fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [image] } });

  await waitFor(() => {
    expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'image', mimeType: 'image/png', data: 'AQID' }));
  });
});

test('shares an image pasted from the clipboard', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();
  const image = new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' });

  fireEvent.paste(screen.getByLabelText('Text to share'), {
    clipboardData: { items: [{ kind: 'file', getAsFile: () => image }], getData: () => '' },
  });

  await waitFor(() => {
    expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'image', mimeType: 'image/png', data: 'AQID' }));
  });
});

test('shares an image dropped into the compose area', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();
  const image = new File([new Uint8Array([1, 2, 3])], 'dropped.png', { type: 'image/png' });

  fireEvent.drop(screen.getByLabelText('Image drop area'), {
    dataTransfer: { files: [image] },
  });

  await waitFor(() => {
    expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'image', mimeType: 'image/png', data: 'AQID' }));
  });
});

test('keeps the existing text sharing flow', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  fireEvent.change(screen.getByLabelText('Text to share'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Share text' }));

  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'text', text: 'hello' }));
});

test('shows connected participants and marks this device', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  act(() => MockWebSocket.lastInstance?.receive({
    type: 'participants',
    deviceId: 'desk-1',
    participants: [
      { id: 'desk-1', name: 'Work laptop' },
      { id: 'phone-1', name: 'Pocket phone' },
    ],
  }));

  expect(screen.getByText('Work laptop')).toBeInTheDocument();
  expect(screen.getByText('Pocket phone')).toBeInTheDocument();
  expect(screen.getByText('(you)')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('saves a device name and sends it to the relay', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  fireEvent.change(screen.getByLabelText('This device'), { target: { value: 'Studio laptop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'set-name', name: 'Studio laptop' }));
  expect(window.localStorage.getItem('phonble-device-name')).toBe('Studio laptop');
});

test('limits device name input to 32 characters', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  expect(screen.getByLabelText('This device')).toHaveAttribute('maxLength', '32');
});

test('re-sends the saved device name after reconnect', async () => {
  window.localStorage.setItem('phonble-device-name', 'Studio laptop');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'set-name', name: 'Studio laptop' }));
});

test('rejects unsupported image types and files over 5 MB', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  fireEvent.change(screen.getByLabelText('Choose image'), {
    target: { files: [new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })] },
  });
  expect(screen.getByText('Choose a PNG, JPEG, WebP, or GIF image.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Choose image'), {
    target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] },
  });
  expect(screen.getByText('Image is too large. Maximum size is 5 MB.')).toBeInTheDocument();
  const sharedUpdates = (MockWebSocket.lastInstance?.sent ?? [])
    .map((message) => JSON.parse(message) as { type: string })
    .filter((update) => update.type === 'image' || update.type === 'text');
  expect(sharedUpdates).toHaveLength(0);
});

test('vibrates when another device pointer enters and leaves this screen', async () => {
  stubVibration();
  await renderWithOtherDevice();

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'laptop', active: true, x: 0.2, y: 0.3 }));
  expect(vibrationCalls).toEqual([HANDOFF_ENTER_PATTERN]);

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'laptop', active: true, x: 0.4, y: 0.5 }));
  expect(vibrationCalls).toEqual([HANDOFF_ENTER_PATTERN]);

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'laptop', active: false, x: 0, y: 0 }));
  expect(vibrationCalls).toEqual([HANDOFF_ENTER_PATTERN, HANDOFF_LEAVE_PATTERN]);
});

test('stops handoff vibration when it is turned off', async () => {
  stubVibration();
  await renderWithOtherDevice();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Vibrate on handoff' }));
  expect(window.localStorage.getItem('phonble-handoff-vibration')).toBe('off');

  vibrationCalls.length = 0;
  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'laptop', active: true, x: 0.2, y: 0.3 }));
  expect(vibrationCalls).toEqual([]);
});

test('keeps the handoff vibration setting between page loads', async () => {
  window.localStorage.setItem('phonble-handoff-vibration', 'off');
  stubVibration();
  await renderWithOtherDevice();

  expect(screen.getByRole('checkbox', { name: 'Vibrate on handoff' })).not.toBeChecked();

  act(() => MockWebSocket.lastInstance?.receive({ type: 'pointer', deviceId: 'laptop', active: true, x: 0.2, y: 0.3 }));
  expect(vibrationCalls).toEqual([]);
});

test('disables the handoff vibration toggle when the browser cannot vibrate', async () => {
  await renderWithOtherDevice();

  expect(screen.getByRole('checkbox', { name: 'Vibrate on handoff' })).toBeDisabled();
});

const stubMissingActivation = () => {
  Object.defineProperty(window.navigator, 'userActivation', {
    configurable: true,
    value: { hasBeenActive: false },
  });
};

test('asks for a tap before relying on haptics without user activation', async () => {
  stubVibration();
  stubMissingActivation();
  await renderWithOtherDevice();

  const arm = screen.getByRole('button', { name: 'Tap to enable vibration' });
  fireEvent.click(arm);

  expect(vibrationCalls).toEqual([HANDOFF_ENTER_PATTERN]);
  expect(screen.queryByRole('button', { name: 'Tap to enable vibration' })).toBeNull();
});

test('stops asking for a tap after any interaction with the page', async () => {
  stubVibration();
  stubMissingActivation();
  await renderWithOtherDevice();

  expect(screen.getByRole('button', { name: 'Tap to enable vibration' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);

  expect(screen.queryByRole('button', { name: 'Tap to enable vibration' })).toBeNull();
});

test('confirms the setting with a short vibration when it is turned on', async () => {
  window.localStorage.setItem('phonble-handoff-vibration', 'off');
  stubVibration();
  await renderWithOtherDevice();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Vibrate on handoff' }));

  expect(vibrationCalls).toEqual([HANDOFF_ENTER_PATTERN]);
  expect(window.localStorage.getItem('phonble-handoff-vibration')).toBe('on');
});


const phoneStatusMessages = () =>
  (MockWebSocket.lastInstance?.sent ?? [])
    .map((message) => JSON.parse(message) as { type: string })
    .filter((update) => update.type === 'phone-status');

const incomingPhoneStatus = (overrides: Record<string, unknown> = {}) => ({
  type: 'phone-status',
  deviceId: 'laptop',
  updatedAt: Date.now(),
  visibility: 'visible',
  lastInteractionAt: Date.now(),
  battery: { level: 0.78, charging: true, chargingTime: 1200, dischargingTime: null },
  network: { online: true, effectiveType: '4g', saveData: false, rtt: 40, downlink: 8 },
  screen: { width: 390, height: 844, dpr: 3, orientation: 'portrait' },
  device: { model: 'Pixel 7', platformVersion: '14', cores: 8, memoryGb: 4 },
  ...overrides,
});

const phoneArea = () => screen.getByRole('complementary', { name: 'Phone placement area' });

test('reports this device status once a session is active', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  await waitFor(() => expect(phoneStatusMessages().length).toBeGreaterThan(0));
  expect(phoneStatusMessages()[0]).toMatchObject({ type: 'phone-status', visibility: 'visible' });
});

test('shows the battery, network and screen state of the connected phone', async () => {
  await renderWithOtherDevice();
  expect(within(phoneArea()).queryByText('78%')).toBeNull();

  act(() => MockWebSocket.lastInstance?.receive(incomingPhoneStatus()));

  const panel = within(phoneArea()).getByRole('status');
  expect(within(panel).getByText('Laptop')).toBeInTheDocument();
  expect(within(panel).getByText('4G')).toBeInTheDocument();
  expect(within(panel).getByText('78%')).toBeInTheDocument();
  expect(within(panel).getByLabelText('Battery: 78%, charging')).toBeInTheDocument();
  expect(within(panel).getByTitle('Pixel 7 · 14 · 8 cores')).toBeInTheDocument();
  expect(within(panel).queryByText('Screen off')).toBeNull();
});

test('shows when the connected phone cannot report battery information', async () => {
  await renderWithOtherDevice();

  act(() => MockWebSocket.lastInstance?.receive(incomingPhoneStatus({ battery: null })));

  const panel = within(phoneArea()).getByRole('status');
  expect(within(panel).getByText('N/A')).toBeInTheDocument();
  expect(within(panel).getByLabelText('Battery: unavailable')).toBeInTheDocument();
});

test('swaps the network indicator for a screen-off hint', async () => {
  await renderWithOtherDevice();

  act(() => MockWebSocket.lastInstance?.receive(incomingPhoneStatus({ visibility: 'hidden' })));

  const panel = within(phoneArea()).getByRole('status');
  expect(within(panel).getByText('Screen off')).toBeInTheDocument();
  expect(within(panel).queryByText('4G')).toBeNull();
});

test('marks a phone status as stale once the phone stops updating it', async () => {
  await renderWithOtherDevice();

  act(() => MockWebSocket.lastInstance?.receive(incomingPhoneStatus({ updatedAt: Date.now() - 120_000 })));

  expect(within(phoneArea()).getByText('Stale · 2m ago')).toBeInTheDocument();
});

test('ignores phone status from devices outside the session', async () => {
  await renderWithOtherDevice();

  act(() => MockWebSocket.lastInstance?.receive(incomingPhoneStatus({ deviceId: 'ghost' })));

  expect(within(phoneArea()).queryByRole('status')).toBeNull();
});
