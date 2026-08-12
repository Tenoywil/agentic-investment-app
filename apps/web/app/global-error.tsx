'use client';

/**
 * Last line of defence: a throw in the ROOT layout, which no route-group
 * boundary can catch. Next.js replaces the whole document here, so this must
 * render its own <html> and <body> and cannot rely on the app's providers,
 * fonts or theme bootstrap — hence the inline styles rather than Tailwind
 * tokens, which may be exactly what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#faf8f3',
          color: '#1e1c19',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '46ch', textAlign: 'center' }} role="alert">
          <h1 style={{ fontSize: '19px', fontWeight: 700, margin: 0 }}>
            Caribbean Capital didn’t load
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#5c544a', marginTop: '10px' }}>
            Your account and your data are unaffected — nothing was changed.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '18px',
              padding: '9px 18px',
              borderRadius: '9px',
              border: '1px solid #124e48',
              background: '#124e48',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: '18px', fontSize: '12px', color: '#5c544a' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
