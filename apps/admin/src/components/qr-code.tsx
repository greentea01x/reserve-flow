import { encode } from 'uqr';

/**
 * The API exposes no QR endpoint and no encoder ships with the app, so the door sign
 * encodes its URL here. `uqr` is a zero-dependency TypeScript encoder; hand-rolling
 * Reed-Solomon for a sign that has to scan on the first try is the wrong kind of lazy.
 *
 * Rendered as inline SVG (one <path>, no raw HTML injection) so it stays crisp in print.
 */
export const QrCode = ({ value, label }: { value: string; label: string }) => {
  // ecc M survives a scuffed printout; border 4 is the quiet zone the QR spec requires.
  const { size, data } = encode(value, { ecc: 'M', border: 4 });

  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y]?.[x] === true) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="h-auto w-full max-w-[15rem]"
    >
      {/* The only raw hex in the app, and deliberately: a QR must be maximum-contrast
          black on white or scanners reject it. Palette tokens would break the sign. */}
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
};
