const assert = require('node:assert/strict'),
  http = require('node:http'),
  fs = require('node:fs'),
  { randomUUID, createHash } = require('node:crypto');
const load = (name) => require('../../dist/src/youtube-publishing/' + name);
module.exports = async function setup(deps) {
  const { YoutubePublishingSettings } = load('youtube-settings'),
    { YoutubeSecretBox } = load('youtube-crypto'),
    { YoutubePublishingRepository } = load('youtube.repository'),
    { YoutubeApiClient } = load('youtube-http'),
    { YoutubeOAuthService } = load('youtube-oauth.service'),
    { YoutubeUploadService } = load('youtube-upload.service'),
    { YoutubePublicationService } = load('youtube-publication.service'),
    { YoutubePublicationWorker } = load('youtube-publication.worker'),
    { YoutubePublishingController } = load('youtube-publishing.controller');
  const channelId = 'UC' + 'A'.repeat(22),
    sessions = new Map(),
    remote = new Map();
  let starts = 0,
    refreshes = 0,
    chunks = 0,
    thumbnailCalls = 0,
    revokes = 0,
    failFinalOnce = true,
    denyThumbnail = true,
    invalidGrant = false,
    quota = false,
    expired = false;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://simulator');
      requests.push({ method: req.method, path: url.pathname });
      const buffers = [];
      for await (const data of req) buffers.push(data);
      const body = Buffer.concat(buffers);
      const json = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body.toString());
        if (form.get('grant_type') === 'refresh_token') {
          refreshes++;
          if (invalidGrant) return json(400, { error: 'invalid_grant' });
        }
        assert.equal(form.get('client_secret'), 'fixture-client-secret');
        return json(200, {
          access_token: 'fixture-access-token',
          expires_in: 3600,
          ...(form.get('grant_type') === 'authorization_code'
            ? { refresh_token: 'fixture-refresh-token' }
            : {}),
          scope:
            'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
          token_type: 'Bearer',
        });
      }
      if (url.pathname === '/revoke') {
        revokes++;
        return json(200, {});
      }
      if (url.pathname.endsWith('/channels'))
        return json(200, {
          items: [
            {
              id: channelId,
              snippet: {
                title: 'Canal local de teste',
              },
            },
          ],
        });
      if (url.pathname.endsWith('/thumbnails/set')) {
        thumbnailCalls++;
        if (denyThumbnail)
          return json(403, { error: { errors: [{ reason: 'forbidden' }] } });
        return json(200, { items: [{}] });
      }
      if (url.pathname === '/youtube/v3/videos') {
        const v = remote.get(url.searchParams.get('id'));
        return json(200, { items: v ? [v] : [] });
      }
      if (
        url.pathname === '/upload/youtube/v3/videos' &&
        req.method === 'POST'
      ) {
        if (quota)
          return json(403, {
            error: { errors: [{ reason: 'quotaExceeded' }] },
          });
        starts++;
        const uploadId = String(starts);
        sessions.set(uploadId, {
          size: Number(req.headers['x-upload-content-length']),
          offset: 0,
          metadata: JSON.parse(body.toString()),
          videoId: null,
        });
        res.writeHead(200, {
          Location:
            'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=' +
            uploadId,
        });
        return res.end();
      }
      if (
        url.pathname === '/upload/youtube/v3/videos' &&
        req.method === 'PUT'
      ) {
        if (expired) return json(404, {});
        const session = sessions.get(url.searchParams.get('upload_id'));
        assert.ok(session);
        if (session.videoId) return json(200, { id: session.videoId });
        const range = req.headers['content-range'];
        if (!range.startsWith('bytes */')) {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
          assert.ok(match);
          assert.equal(Number(match[1]), session.offset);
          assert.equal(body.length, Number(match[2]) - Number(match[1]) + 1);
          chunks++;
          session.offset = Number(match[2]) + 1;
          if (session.offset === session.size) {
            session.videoId = 'testVid' + String(starts).padStart(4, '0');
            remote.set(session.videoId, {
              id: session.videoId,
              snippet: { channelId, title: session.metadata.snippet.title },
              status: {
                uploadStatus: 'uploaded',
                privacyStatus: session.metadata.status.privacyStatus,
                ...(session.metadata.status.publishAt
                  ? { publishAt: session.metadata.status.publishAt }
                  : {}),
              },
              processingDetails: { processingStatus: 'processing' },
            });
            if (failFinalOnce) {
              failFinalOnce = false;
              return res.destroy();
            }
            return json(200, { id: session.videoId });
          }
        }
        res.writeHead(
          308,
          session.offset ? { Range: 'bytes=0-' + (session.offset - 1) } : {},
        );
        return res.end();
      }
      json(404, {});
    } catch {
      res.writeHead(500);
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const values = {
    YOUTUBE_CLIENT_ID: 'fixture-client-id',
    YOUTUBE_CLIENT_SECRET: 'fixture-client-secret',
    YOUTUBE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    YOUTUBE_UPLOADS_ENABLED: 'true',
    YOUTUBE_PUBLIC_PUBLICATION_ENABLED: 'true',
    YOUTUBE_REDIRECT_URI:
      'http://127.0.0.1:33852/youtube-publishing/oauth/callback',
    FRONTEND_URL: 'http://127.0.0.1:33853',
  };
  const originalGet = deps.config.get;
  deps.config.get = (name) => values[name] ?? originalGet(name);
  const settings = new YoutubePublishingSettings(deps.config);
  settings.chunkBytes = 256 * 1024;
  const transport = {
    send: (url, init) => {
      const original = new URL(url);
      assert.ok(
        ['www.googleapis.com', 'oauth2.googleapis.com'].includes(
          original.hostname,
        ),
        'only known Google hosts',
      );
      return fetch(
        `http://127.0.0.1:${port}${original.pathname}${original.search}`,
        { ...init, redirect: 'manual' },
      );
    },
  };
  const repo = new YoutubePublishingRepository(deps.db),
    box = new YoutubeSecretBox(deps.config),
    api = new YoutubeApiClient(transport, repo, settings),
    oauth = new YoutubeOAuthService(settings, box, repo, api),
    upload = new YoutubeUploadService(api, settings),
    service = new YoutubePublicationService(
      settings,
      repo,
      oauth,
      upload,
      deps.preparations,
      deps.preparationRepo,
      deps.thumbs,
      deps.renders,
      deps.videos,
      deps.assets,
      deps.storage,
    ),
    worker = new YoutubePublicationWorker(
      settings,
      repo,
      service,
      oauth,
      upload,
      box,
    );
  const providers = [
    { provide: YoutubePublishingSettings, useValue: settings },
    { provide: YoutubePublishingRepository, useValue: repo },
    { provide: YoutubeOAuthService, useValue: oauth },
    { provide: YoutubePublicationService, useValue: service },
  ];
  async function run({
    request,
    base,
    key,
    id,
    renderId,
    videoAsset,
    client,
    root,
  }) {
    const prefix = '/youtube-publishing';
    assert.equal(
      (await request(prefix + '/configuration', 'GET', undefined, false))
        .status,
      401,
    );
    const denied = await fetch(base + prefix + '/oauth/authorize', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        Origin: 'https://evil.invalid',
        'Content-Type': 'application/json',
      },
      body: '{"confirm":true}',
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (await request(prefix + '/oauth/authorize', 'GET')).status,
      404,
    );
    const auth = await request(prefix + '/oauth/authorize', 'POST', {
      confirm: true,
    });
    assert.equal(auth.status, 201, JSON.stringify(auth.body));
    const authorizeUrl = new URL(auth.body.url),
      state = authorizeUrl.searchParams.get('state'),
      cookie = auth.headers.get('set-cookie').split(';')[0];
    assert.equal(authorizeUrl.searchParams.get('access_type'), 'offline');
    assert.equal(
      authorizeUrl.searchParams.get('code_challenge_method'),
      'S256',
    );
    assert.ok(authorizeUrl.searchParams.get('code_challenge'));
    assert.ok(!auth.body.url.includes('fixture-client-secret'));
    const callback = async (s, c = cookie, extra = 'code=fixture-code') =>
      fetch(
        base +
          prefix +
          '/oauth/callback?' +
          new URLSearchParams({ state: s }).toString() +
          '&' +
          extra,
        {
          headers: { Authorization: 'Bearer ' + key, Cookie: c },
          redirect: 'manual',
        },
      );
    const wrong = await callback(state, 'youtube_oauth_browser=wrong');
    assert.ok(wrong.headers.get('location').includes('denied_or_expired'));
    const good = await callback(state);
    assert.equal(good.status, 303);
    assert.ok(good.headers.get('location').includes('connected'));
    assert.ok(!good.headers.get('location').includes('token'));
    const repeated = await callback(state);
    assert.ok(repeated.headers.get('location').includes('denied_or_expired'));
    const consent = await request(prefix + '/oauth/authorize', 'POST', {
      confirm: true,
    });
    const denial = await callback(
      new URL(consent.body.url).searchParams.get('state'),
      consent.headers.get('set-cookie').split(';')[0],
      'error=access_denied',
    );
    assert.ok(denial.headers.get('location').includes('denied_or_expired'));
    const expiredAuth = await request(prefix + '/oauth/authorize', 'POST', {
      confirm: true,
    });
    const expiredState = new URL(expiredAuth.body.url).searchParams.get(
      'state',
    );
    await client.query(
      "UPDATE youtube_oauth_states SET expires_at=NOW()-INTERVAL '1 minute' WHERE state_hash=$1",
      [createHash('sha256').update(expiredState).digest('hex')],
    );
    const expiredCallback = await callback(
      expiredState,
      expiredAuth.headers.get('set-cookie').split(';')[0],
    );
    assert.ok(
      expiredCallback.headers.get('location').includes('denied_or_expired'),
    );
    let channels = (await request(prefix + '/configuration')).body.channels;
    assert.equal(channels.length, 1);
    const channel = channels[0];
    assert.equal(channel.channelId, channelId);
    assert.ok(!JSON.stringify(channels).includes('token'));
    const stored = await repo.channel(settings.owner, channel.id);
    assert.ok(
      stored.credentials &&
        !stored.credentials.includes('fixture-refresh-token'),
    );
    let creds = JSON.parse(
      box.open(stored.credentials, `channel:${settings.owner}:${channel.id}`),
    );
    creds.expiresAt = 0;
    await client.query(
      'UPDATE youtube_channel_connections SET credentials=$2 WHERE id=$1',
      [
        channel.id,
        box.seal(
          JSON.stringify(creds),
          `channel:${settings.owner}:${channel.id}`,
        ),
      ],
    );
    await oauth.token(channel.id);
    assert.equal(refreshes, 1);
    const refreshed = await repo.channel(settings.owner, channel.id);
    assert.equal(
      JSON.parse(
        box.open(
          refreshed.credentials,
          `channel:${settings.owner}:${channel.id}`,
        ),
      ).refreshToken,
      'fixture-refresh-token',
    );
    // Enrich existing fixture with the codec metadata created by the real production renderer.
    await client.query(
      'UPDATE content_assets SET metadata=metadata||\'{"codec":"h264","audioCodec":"aac"}\'::jsonb WHERE id=$1',
      [videoAsset],
    );
    await client.query(
      "UPDATE content_video_renders SET snapshot=jsonb_set(snapshot,'{config,codec}','\"libx264\"'::jsonb) WHERE id=$1",
      [renderId],
    );
    await client.query(
      "UPDATE content_video_renders SET snapshot=jsonb_set(snapshot,'{config,audioCodec}','\"aac\"'::jsonb) WHERE id=$1",
      [renderId],
    );
    const prep = await deps.preparationRepo.get(id);
    const options = {
      privacy: 'private',
      madeForKids: false,
      containsSyntheticMedia: true,
      categoryId: '22',
      license: 'youtube',
      scheduledAt: null,
      timeZone: 'America/Sao_Paulo',
    };
    const input = {
      projectId: id,
      target: 'YOUTUBE_VIDEO',
      preparationRevision: prep.revision,
      connectionId: channel.id,
      idempotencyKey: randomUUID(),
      options,
      confirm: true,
    };
    const valid = await request(
      prefix + '/publications/validate',
      'POST',
      input,
    );
    assert.equal(valid.status, 201, JSON.stringify(valid.body));
    assert.equal(starts, 0);
    assert.equal(
      (
        await request(prefix + '/publications', 'POST', {
          ...input,
          options: { privacy: 'private' },
        })
      ).status,
      400,
      'declarations required',
    );
    const created = await request(prefix + '/publications', 'POST', input);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const publication = created.body;
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(prefix + '/publications', 'POST', {
          ...input,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    assert.ok(concurrent.every((r) => r.body.id === publication.id));
    assert.equal(
      (
        await request(
          prefix + '/publications/' + publication.id + '/upload',
          'POST',
          { confirm: false },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          prefix + '/publications/' + publication.id + '/upload',
          'POST',
          { confirm: true },
        )
      ).status,
      201,
    );
    const before = fs.readFileSync(root + '/fixture.mp4');
    const hash = createHash('sha256').update(before).digest('hex');
    await Promise.all([worker.tick(), worker.tick()]);
    let row = await repo.publication(settings.owner, publication.id);
    assert.ok(row.session_cipher);
    assert.ok(!row.session_cipher.includes('upload_id'));
    assert.ok(row.session_started);
    assert.equal(starts, 1);
    assert.equal(row.status, 'UPLOADING', 'lost final response is recoverable');
    assert.ok(chunks >= 2, 'actual streaming chunks');
    assert.equal(remote.size, 1);
    await repo.update(row.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    row = await repo.publication(settings.owner, publication.id);
    assert.equal(row.status, 'PROCESSING');
    assert.ok(row.youtube_video_id);
    assert.equal(starts, 1, 'never creates second session');
    await repo.update(row.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    row = await repo.publication(settings.owner, publication.id);
    assert.equal(row.status, 'PROCESSING');
    assert.equal(row.thumbnail_status, 'FAILED');
    assert.equal(starts, 1);
    remote.get(row.youtube_video_id).status.uploadStatus = 'processed';
    remote.get(row.youtube_video_id).processingDetails.processingStatus =
      'succeeded';
    await repo.update(row.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    row = await repo.publication(settings.owner, publication.id);
    assert.equal(row.status, 'PRIVATE');
    assert.equal(Number(row.confirmed_bytes), before.length);
    denyThumbnail = false;
    const thumb = await request(
      prefix + '/publications/' + row.id + '/thumbnail/retry',
      'POST',
      { confirm: true },
    );
    assert.equal(thumb.status, 201);
    assert.equal(starts, 1);
    assert.equal(
      (await repo.publication(settings.owner, row.id)).thumbnail_status,
      'COMPLETED',
    );
    assert.equal(
      hash,
      createHash('sha256')
        .update(fs.readFileSync(root + '/fixture.mp4'))
        .digest('hex'),
      'original file unchanged',
    );
    const publicData = (await request(prefix + '/publications/' + row.id)).body;
    const serialized = JSON.stringify(publicData);
    for (const secret of [
      'fixture-access-token',
      'fixture-refresh-token',
      'fixture-client-secret',
      'session_cipher',
      'upload_id=',
      'videoKey',
      'thumbnailKey',
    ])
      assert.ok(!serialized.includes(secret), secret);
    assert.ok(publicData.publication.youtubeUrl.endsWith(row.youtube_video_id));
    const foreign = await repo
      .insert(
        'foreign-owner',
        id,
        renderId,
        channel.id,
        'YOUTUBE_VIDEO',
        randomUUID(),
        row.snapshot,
      )
      .catch(() => null);
    assert.equal(foreign, null, 'composite owner/channel foreign key');
    assert.equal(
      (await request(prefix + '/publications/' + randomUUID())).status,
      404,
    );
    // Each additional scenario uses a distinct immutable render, preserving the first publication.
    async function variant(changes = {}, create = true) {
      const newRender = randomUUID();
      await client.query(
        'INSERT INTO content_video_renders(id,project_id,status,progress,snapshot,output_asset_id) SELECT $1,project_id,status,progress,snapshot,output_asset_id FROM content_video_renders WHERE id=$2',
        [newRender, renderId],
      );
      const current = await deps.preparationRepo.get(id);
      await deps.preparations.save(id, {
        revision: current.revision,
        data: {
          ...current.data,
          renderJobId: newRender,
          metadataRenderJobId: newRender,
          chaptersEnabled: false,
          status: 'READY',
          description: current.data.description + ' ',
        },
      });
      const fresh = await deps.preparationRepo.get(id);
      const req = {
        ...input,
        ...changes,
        preparationRevision: fresh.revision,
        idempotencyKey: randomUUID(),
        options: { ...options, ...changes.options },
      };
      if (!create) return req;
      const response = await request(prefix + '/publications', 'POST', req);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body;
    }
    const scheduled = await variant({
      options: {
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        privacy: 'private',
      },
    });
    await service.queue(scheduled.id);
    await worker.tick();
    let scheduledRow = await repo.publication(settings.owner, scheduled.id);
    assert.ok(scheduledRow.youtube_video_id);
    const scheduledRemote = remote.get(scheduledRow.youtube_video_id);
    scheduledRemote.status.uploadStatus = 'processed';
    scheduledRemote.processingDetails.processingStatus = 'succeeded';
    await repo.update(scheduled.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    assert.equal(
      (await repo.publication(settings.owner, scheduled.id)).status,
      'SCHEDULED',
    );
    scheduledRemote.status.privacyStatus = 'public';
    delete scheduledRemote.status.publishAt;
    await repo.update(scheduled.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    assert.equal(
      (await repo.publication(settings.owner, scheduled.id)).status,
      'PUBLISHED',
    );
    const uncertain = await variant();
    await repo.update(uncertain.id, {
      status: 'UPLOADING',
      session_started: true,
      next_attempt_at: new Date(0),
    });
    const beforeUncertain = starts;
    await worker.tick();
    assert.equal(
      (await repo.publication(settings.owner, uncertain.id)).status,
      'NEEDS_ATTENTION',
    );
    assert.equal(starts, beforeUncertain);
    assert.equal(
      (
        await request(
          prefix + '/publications/' + uncertain.id + '/retry',
          'POST',
          { confirm: true },
        )
      ).status,
      400,
    );
    const cancelled = await variant();
    await service.queue(cancelled.id);
    await repo.cancel(settings.owner, cancelled.id);
    assert.equal(
      (await repo.publication(settings.owner, cancelled.id)).status,
      'CANCELLED',
    );
    const cancelledPrep = await deps.preparationRepo.get(id);
    const replacement = await request(prefix + '/publications', 'POST', {
      ...input,
      preparationRevision: cancelledPrep.revision,
      idempotencyKey: randomUUID(),
      options: { ...options, privacy: 'unlisted' },
    });
    assert.equal(replacement.status, 201);
    assert.notEqual(
      replacement.body.id,
      cancelled.id,
      'a never-started cancelled draft may be reviewed and recreated',
    );
    const quotaJob = await variant();
    quota = true;
    await service.queue(quotaJob.id);
    const quotaStarts = starts;
    await worker.tick();
    assert.equal(starts, quotaStarts);
    assert.equal(
      (await repo.publication(settings.owner, quotaJob.id)).error_code,
      'QUOTA',
    );
    quota = false;
    const sessionJob = await variant();
    expired = true;
    await service.queue(sessionJob.id);
    await worker.tick();
    assert.equal(
      (await repo.publication(settings.owner, sessionJob.id)).error_code,
      'SESSION_EXPIRED',
    );
    const expiredStarts = starts;
    await worker.tick();
    assert.equal(starts, expiredStarts);
    expired = false;
    assert.equal(
      (await request(prefix + '/automation/' + id)).body.settings,
      null,
      'automation off by default',
    );
    await variant({}, false);
    await service.saveAutomation(id, {
      enabled: true,
      mode: 'DRAFT',
      connectionId: channel.id,
      target: 'YOUTUBE_VIDEO',
      madeForKids: false,
      containsSyntheticMedia: true,
      maxPublications: 10,
      confirm: true,
    });
    const previousCount = (await repo.list(settings.owner)).length,
      previousStarts = starts;
    await service.automate();
    const count = (await repo.list(settings.owner)).length;
    assert.equal(
      count,
      previousCount + 1,
      'explicit automation creates draft for newly approved render',
    );
    assert.equal(starts, previousStarts, 'draft automation never uploads');
    await service.automate();
    assert.equal(
      (await repo.list(settings.owner)).length,
      count,
      'automation does not loop or duplicate',
    );
    await variant({}, false);
    await service.saveAutomation(id, {
      enabled: true,
      mode: 'PRIVATE',
      connectionId: channel.id,
      target: 'YOUTUBE_VIDEO',
      madeForKids: false,
      containsSyntheticMedia: true,
      maxPublications: 10,
      confirm: true,
    });
    await service.automate();
    assert.ok(
      (await repo.list(settings.owner)).some((p) => p.status === 'QUEUED'),
      'explicit private automation queues only approved preparation',
    );
    await worker.tick();
    // Real local portrait MP4 fixture, sent only to the HTTP simulator.
    const { spawnSync } = require('node:child_process');
    const portraitFile = root + '/portrait-fixture.mp4';
    const generated = spawnSync(require('ffmpeg-static'), [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=180x320:r=30:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      portraitFile,
    ]);
    assert.equal(generated.status, 0, String(generated.stderr));
    const portraitRender = randomUUID(),
      portraitAsset = randomUUID();
    await deps.storage.save(
      `${id}/portrait.mp4`,
      fs.readFileSync(portraitFile),
    );
    await client.query(
      "INSERT INTO content_assets(id,project_id,type,source,status,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,'VIDEO','RENDERED','READY',$3,'video/mp4',180,320,2,'{\"codec\":\"h264\",\"audioCodec\":\"aac\"}')",
      [portraitAsset, id, `${id}/portrait.mp4`],
    );
    await client.query(
      "INSERT INTO content_video_renders(id,project_id,status,progress,snapshot,output_asset_id) VALUES($1,$2,'COMPLETED',100,$3::jsonb,$4)",
      [
        portraitRender,
        id,
        JSON.stringify({
          projectRevision: 0,
          title: 'Short de teste',
          config: {
            width: 180,
            height: 320,
            fps: 30,
            codec: 'libx264',
            audioCodec: 'aac',
          },
          totalDurationSeconds: 2,
          scenes: [],
        }),
        portraitAsset,
      ],
    );
    const shortPrep = await deps.preparationRepo.get(
      id,
      undefined,
      'YOUTUBE_SHORTS',
    );
    await deps.preparations.save(
      id,
      {
        revision: shortPrep.revision,
        data: {
          ...prep.data,
          renderJobId: portraitRender,
          metadataRenderJobId: portraitRender,
          chaptersEnabled: false,
          status: 'READY',
        },
      },
      'YOUTUBE_SHORTS',
    );
    const shortReady = await deps.preparationRepo.get(
      id,
      undefined,
      'YOUTUBE_SHORTS',
    );
    const shortResponse = await request(prefix + '/publications', 'POST', {
      ...input,
      target: 'YOUTUBE_SHORTS',
      preparationRevision: shortReady.revision,
      idempotencyKey: randomUUID(),
    });
    assert.equal(shortResponse.status, 201, JSON.stringify(shortResponse.body));
    assert.equal(shortResponse.body.thumbnailStatus, 'UNSUPPORTED');
    await service.queue(shortResponse.body.id);
    await repo.update(shortResponse.body.id, { next_attempt_at: new Date(0) });
    await worker.tick();
    const shortRow = await repo.publication(
      settings.owner,
      shortResponse.body.id,
    );
    assert.ok(shortRow.youtube_video_id);
    assert.equal(shortRow.snapshot.height, 320);
    const thumbnailsBefore = thumbnailCalls;
    await assert.rejects(() => service.retryThumbnail(shortRow.id));
    assert.equal(
      thumbnailCalls,
      thumbnailsBefore,
      'Shorts cover is not uploaded through API',
    );

    const broken = await repo.channel(settings.owner, channel.id);
    creds = JSON.parse(
      box.open(broken.credentials, `channel:${settings.owner}:${channel.id}`),
    );
    creds.expiresAt = 0;
    await client.query(
      'UPDATE youtube_channel_connections SET credentials=$2 WHERE id=$1',
      [
        channel.id,
        box.seal(
          JSON.stringify(creds),
          `channel:${settings.owner}:${channel.id}`,
        ),
      ],
    );
    invalidGrant = true;
    await assert.rejects(
      () => oauth.token(channel.id),
      (e) => e.code === 'AUTH',
    );
    assert.equal(
      (await repo.channel(settings.owner, channel.id)).status,
      'EXPIRED',
    );
    invalidGrant = false;
    const disconnected = await request(
      prefix + '/channels/' + channel.id,
      'DELETE',
      { confirm: true },
    );
    assert.equal(disconnected.status, 200);
    assert.ok(revokes > 0);
    assert.equal(
      (await repo.channel(settings.owner, channel.id)).credentials,
      null,
    );
    assert.equal(
      (await repo.channel(settings.owner, channel.id)).status,
      'REVOKED',
    );
    assert.ok(
      (await repo.list(settings.owner)).length > 0,
      'history preserved',
    );
    assert.equal((await repo.rule(settings.owner, id)).enabled, false);
    // Reconnect only to the simulator and leave a real validated draft for the browser confirmation test.
    const browserNonce='fixture-browser-reconnection';const reconnect=await oauth.authorize(browserNonce);await oauth.callback({state:new URL(reconnect.url).searchParams.get('state'),code:'fixture-code'},browserNonce);
    await variant();
    // Restore the original preparation for the shared Stage 7/8 browser regression.
    await client.query(
      'UPDATE content_publication SET data=$2::jsonb WHERE project_id=$1',
      [id, JSON.stringify(prep.data)],
    );
    await client.query("DELETE FROM content_publication_destinations WHERE project_id=$1 AND target='YOUTUBE_SHORTS'",[id]); // Restore the shared Stage 8 fixture, not application data.
    const operations = (await request(prefix + '/operations')).body;
    assert.ok(operations.some((o) => o.operation === 'VIDEOS_INSERT'));
    assert.ok(!JSON.stringify(operations).includes('token='));
    fs.writeFileSync(
      root + '/youtube-publishing-evidence.json',
      JSON.stringify(
        {
          starts,
          chunks,
          refreshes,
          thumbnailCalls,
          revokes,
          requests,
          coverage:
            'OAuth/PKCE/browser-state/replay/denial/encrypted tokens/refresh/ownership/confirmed upload/chunk streaming/308/final response lost/recovery/no duplicate/processing/private/scheduled/public/thumbnail partial failure/cancellation/ambiguous session/quota/expired session/invalid_grant/automation limits/revocation/no external requests',
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS YouTube publishing simulator: OAuth, resumable upload, ambiguous results, idempotency, privacy/schedule, partial failures and revocation.',
    );
  }
  return {
    controllers: [YoutubePublishingController],
    providers,
    run,
    close: () => new Promise((r) => server.close(r)),
  };
};
