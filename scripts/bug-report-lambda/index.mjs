// DraftDown bug-report receiver — Lambda Function URL handler.
// Stores the report in S3 and emails a summary via SES.
// Node 20 runtime bundles AWS SDK v3; this file has zero packaged deps.
// CORS headers are injected by the Function URL config — do NOT emit them here.
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const BUCKET = process.env.BUCKET;
const EMAIL = process.env.EMAIL;   // recipient
const FROM = process.env.FROM;     // sender on the SES-verified DKIM'd domain
// SES from the app's own domain (bugs@draftdownapp.com, DKIM-verified in
// Route53). NOT from the gmail address (Gmail spam-filters spoofed senders)
// and NOT SNS subscriptions (Gmail link scanners auto-click the one-click
// unsubscribe link, silently deactivating the subscription after the first
// notification).
const s3 = new S3Client({});
const ses = new SESClient({});

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function handler(event) {
  try {
    if (event.requestContext?.http?.method !== 'POST') {
      return json(405, { ok: false, error: 'POST only' });
    }
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    let report;
    try {
      report = JSON.parse(raw);
    } catch {
      return json(400, { ok: false, error: 'Invalid JSON' });
    }

    const description = String(report.description ?? '').trim().slice(0, 10000);
    if (!description) return json(400, { ok: false, error: 'Description is required' });

    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const { screenshot, model, ...meta } = report;
    meta.description = description;

    const puts = [
      s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${id}/report.json`,
        Body: JSON.stringify(meta, null, 2),
        ContentType: 'application/json',
      })),
    ];
    const keys = [`${id}/report.json`];

    if (typeof screenshot === 'string' && screenshot.length > 0) {
      const b64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      puts.push(s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${id}/screenshot.jpg`,
        Body: Buffer.from(b64, 'base64'),
        ContentType: 'image/jpeg',
      })));
      keys.push(`${id}/screenshot.jpg`);
    }

    if (typeof model === 'string' && model.length > 0) {
      puts.push(s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${id}/model.draftdown`,
        Body: Buffer.from(model, 'base64'),
        ContentType: 'application/octet-stream',
      })));
      keys.push(`${id}/model.draftdown`);
    }

    await Promise.all(puts);

    const links = await Promise.all(keys.map(async (Key) =>
      `${Key.split('/')[1]}: ${await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key }), { expiresIn: 7 * 24 * 3600 })}`
    ));
    const consoleLink =
      `https://s3.console.aws.amazon.com/s3/buckets/${BUCKET}?region=us-east-1&prefix=${encodeURIComponent(id + '/')}`;

    const stats = report.stats ? JSON.stringify(report.stats) : 'n/a';
    const recentErrors = Array.isArray(report.consoleEntries) && report.consoleEntries.length
      ? report.consoleEntries.slice(-10).map((e) => `[${e.level}] ${e.time} ${e.message}`).join('\n')
      : '(none)';

    const bodyText = [
      description,
      '',
      `Reporter email: ${report.reporterEmail || '(not provided)'}`,
      `App version:    ${report.appVersion || 'unknown'}`,
      `Platform:       ${report.platform || 'unknown'}`,
      `Timestamp:      ${report.timestamp || 'unknown'}`,
      `User agent:     ${report.userAgent || 'unknown'}`,
      `Model attached: ${keys.some((k) => k.endsWith('.draftdown')) ? 'yes' : report.modelSkipped ? 'skipped (too large)' : 'no'}`,
      `Stats:          ${stats}`,
      '',
      'Recent console entries:',
      recentErrors,
      '',
      `S3 console (durable): ${consoleLink}`,
      '',
      'Download links (expire with signer credentials, ≤12h):',
      ...links,
    ].join('\n');

    // Notification is best-effort: the S3 archive is the source of truth.
    let emailed = true;
    try {
      await ses.send(new SendEmailCommand({
        Source: `DraftDown Bug Reports <${FROM}>`,
        Destination: { ToAddresses: [EMAIL] },
        Message: {
          Subject: { Data: `[DraftDown bug] ${description.slice(0, 60)}` },
          Body: { Text: { Data: bodyText } },
        },
      }));
    } catch (err) {
      emailed = false;
      console.error('SES send failed (report still archived):', err);
    }

    return json(200, { ok: true, id, emailed });
  } catch (err) {
    console.error('bug-report handler failed:', err);
    return json(500, { ok: false, error: String(err?.message ?? err) });
  }
}
