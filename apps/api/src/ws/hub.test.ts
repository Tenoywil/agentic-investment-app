import { expect, describe as group, test } from 'bun:test';
import { type CcnEvent, type Sink, WsHub, shouldReceive } from './hub';

function fakeSink(): Sink & { messages: string[] } {
  const messages: string[] = [];
  return { messages, send: (d) => messages.push(d) };
}

group('shouldReceive (tenant match)', () => {
  const ev: CcnEvent = {
    type: 'order.created',
    user_id: 'u1',
    partner_id: 'p1',
    status: 'created',
  };

  test('matches the event user', () => {
    expect(shouldReceive({ userId: 'u1' }, ev)).toBe(true);
  });
  test('matches the event partner', () => {
    expect(shouldReceive({ userId: 'op', partnerId: 'p1' }, ev)).toBe(true);
  });
  test('a different tenant does not match', () => {
    expect(shouldReceive({ userId: 'u2', partnerId: 'p2' }, ev)).toBe(false);
  });
  test('empty event ids never match', () => {
    expect(shouldReceive({ userId: 'u1' }, { type: 'x' })).toBe(false);
    expect(
      shouldReceive(
        { userId: 'u1', partnerId: 'p1' },
        { type: 'x', partner_id: null, user_id: null },
      ),
    ).toBe(false);
  });
});

group('WsHub fan-out', () => {
  test('delivers only to the matching tenant', () => {
    const hub = new WsHub();
    const a = fakeSink();
    const b = fakeSink();
    hub.add(a, { userId: 'u1' });
    hub.add(b, { userId: 'u2' });

    const delivered = hub.dispatch({ type: 'order.created', user_id: 'u1', status: 'created' });
    expect(delivered).toBe(1);
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(0);
    expect(JSON.parse(a.messages[0] ?? '{}')).toMatchObject({
      type: 'order.created',
      user_id: 'u1',
    });
  });

  test('an order reaches both its customer and its partner operator', () => {
    const hub = new WsHub();
    const customer = fakeSink();
    const operator = fakeSink();
    hub.add(customer, { userId: 'u1' });
    hub.add(operator, { userId: 'op', partnerId: 'sag' });

    const delivered = hub.dispatch({
      type: 'order.accepted',
      user_id: 'u1',
      partner_id: 'sag',
      status: 'accepted',
    });
    expect(delivered).toBe(2);
    expect(customer.messages).toHaveLength(1);
    expect(operator.messages).toHaveLength(1);
  });

  test('removing a registration stops delivery', () => {
    const hub = new WsHub();
    const a = fakeSink();
    const entry = hub.add(a, { userId: 'u1' });
    expect(hub.size()).toBe(1);
    hub.remove(entry);
    expect(hub.size()).toBe(0);
    expect(hub.dispatch({ type: 'order.settled', user_id: 'u1' })).toBe(0);
    expect(a.messages).toHaveLength(0);
  });
});
