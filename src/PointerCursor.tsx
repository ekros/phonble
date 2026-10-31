import { MousePointer2 } from 'lucide-react';

type PointerCursorProps = {
  x: number;
  y: number;
};

const PointerCursor = ({ x, y }: PointerCursorProps) => (
  <div
    className="pointer-cursor"
    style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    data-testid="remote-pointer"
    aria-hidden="true"
  >
    <MousePointer2 size={30} strokeWidth={1.8} />
  </div>
);

export default PointerCursor;
