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
  act(() => MockWebSocket.lastInstance?.open());
};

afterEach(() => {
  cleanup();
  MockWebSocket.lastInstance = null;
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
});

test('renders a received image with a download link', async () => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket });
  await renderConnected();

  act(() => MockWebSocket.lastInstance?.receive({ type: 'image', mimeType: 'image/png', data: 'AQID' }));

  expect(screen.getByRole('img', { name: 'Shared image' })).toHaveAttribute('src', 'data:image/png;base64,AQID');
  expect(screen.getByRole('link', { name: 'Download image' })).toHaveAttribute('download', 'shared-image.png');
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
