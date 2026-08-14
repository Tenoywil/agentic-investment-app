import type { AppDeps } from '../context';
import { resolveTenant } from '../tenant';
import type { Registration, WsHub } from './hub';

/**
 * The browser's realtime transport.
 *
 * Extracted from the composition root so it can be tested. It used to live
 * inline inside `Bun.serve`'s fetch, which meant the one piece of the realtime
 * path a browser actually touches — the framing, the heartbeat, the headers that
 * stop a proxy buffering the stream to death — was the only piece with no test
 * at all. The hub and the Postgres bridge either side of it were both covered.
 *
 * Why SSE rather than the WebSocket the hub also serves: every authenticated
 * request has to be same-origin or the Better Auth cookie is third-party and
 * never sent, so it must travel through the web app's `/api/:path*` rewrite, and
 * an HTTP rewrite forwards a request and a response but not an `Upgrade`
 * handshake. See apps/web/lib/realtime.ts.
 */
export async function handleSse(
  deps: AppDeps,
  hub: WsHub,
  req: Request,
  /** Injected so a test does not wait 25 seconds to observe a heartbeat. */
  heartbeatMs = 25_000,
): Promise<Response> {
  const tenant = await resolveTenant(deps, req.headers);
  if (!tenant) return new Response('unauthorized', { status: 401 });

  const sub = { userId: tenant.user.id, partnerId: tenant.partnerId };
  let entry: Registration | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // The client vanished between the hub's dispatch and this write.
          // Dropping the frame is right; throwing would take down the dispatch
          // loop for every other subscriber on the same event.
        }
      };
      entry = hub.add({ send: (d) => write(`data: ${d}\n\n`) }, sub);
      // An idle connection is indistinguishable from a dead one to any proxy
      // between here and the browser, and both Render and Vercel will close it.
      // A comment frame is ignored by EventSource and keeps it open.
      write(': connected\n\n');
      // The hub keeps no replay buffer, so a client that reconnects has a hole
      // in its history. Reconnecting quickly keeps the hole small; the client
      // closes it by refetching on every open.
      write('retry: 3000\n\n');
      heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (entry) hub.remove(entry);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and several CDNs buffer a response until it completes, which for
      // a stream that never completes means delivering nothing at all.
      'x-accel-buffering': 'no',
      // This route is served by Bun directly, ahead of the Hono app, so the CORS
      // middleware never sees it. In production that is invisible — the browser
      // reaches it same-origin through the web app's rewrite — but in local
      // development the web app is on :3000 and the API on :3001, and without
      // these the stream is refused before it opens.
      'access-control-allow-origin': deps.config.APP_WEB_ORIGIN,
      'access-control-allow-credentials': 'true',
    },
  });
}
