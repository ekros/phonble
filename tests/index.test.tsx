import { afterEach, expect, test } from '@rstest/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';

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

afterEach(() => {
  cleanup();
  MockWebSocket.lastInstance = null;
  window.localStorage.clear();
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
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
  expect(screen.getByText('abc-defg-hij')).toBeInTheDocument();
  expect(window.localStorage.getItem('phonble-session-id')).toBe('abc-defg-hij');

  fireEvent.click(screen.getByRole('button', { name: 'Leave session' }));
  act(() => MockWebSocket.lastInstance?.receive({ type: 'session-left' }));
  fireEvent.change(screen.getByLabelText('Session ID'), { target: { value: 'phone00001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join' }));
  expect(MockWebSocket.lastInstance?.sent).toContain(JSON.stringify({ type: 'join-session', sessionId: 'pho-ne00-001' }));
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
  expect(MockWebSocket.lastInstance?.sent).toHaveLength(0);
});
