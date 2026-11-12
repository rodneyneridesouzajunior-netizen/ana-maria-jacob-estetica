import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLimitedBody, RequestBodyTooLargeError } from './read-limited-body.ts';

const encoder = new TextEncoder();
function streamed(parts, headers = {}) {
  let read = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (read < parts.length) controller.enqueue(parts[read++]);
      else controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  return {
    req: new Request('http://unit.invalid/', { method: 'POST', body, duplex: 'half', headers }),
    read: () => read, cancelled: () => cancelled
  };
}

test('reader accepts exact byte limit and split Unicode without corruption', async () => {
  const bytes = encoder.encode('ação 🧪');
  const sample = streamed([bytes.slice(0, 2), bytes.slice(2)]);
  assert.deepEqual(await readLimitedBody(sample.req, bytes.length), bytes);
});

for (const headers of [{}, { 'content-length': '1' }]) {
  test('overflow cancels without reading remaining chunks: ' + JSON.stringify(headers), async () => {
    const sample = streamed([new Uint8Array(8), new Uint8Array(3), new Uint8Array(20)], headers);
    await assert.rejects(readLimitedBody(sample.req, 10), RequestBodyTooLargeError);
    assert.equal(sample.read(), 2);
    assert.equal(sample.cancelled(), true);
    assert.equal(sample.req.body.locked, false);
  });
}

test('declared excess rejects before reading and empty body remains empty', async () => {
  const sample = streamed([new Uint8Array(4)], { 'content-length': '999' });
  await assert.rejects(readLimitedBody(sample.req, 10), RequestBodyTooLargeError);
  assert.equal(sample.read(), 0);
  assert.equal((await readLimitedBody(new Request('http://unit.invalid/'), 10)).length, 0);
});

test('failed or stalled producer cancellation cannot mask or delay size rejection', async () => {
  for (const cancel of [() => Promise.reject(new Error('cancel failed')), () => new Promise(() => {})]) {
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(11)); }, cancel
    }, { highWaterMark: 0 });
    const req = new Request('http://unit.invalid/', { method: 'POST', body, duplex: 'half' });
    let timer;
    try {
      await assert.rejects(Promise.race([
        readLimitedBody(req, 10),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('rejection delayed')), 1000); })
      ]), RequestBodyTooLargeError);
      assert.equal(body.locked, false);
    } finally { clearTimeout(timer); }
  }
});
