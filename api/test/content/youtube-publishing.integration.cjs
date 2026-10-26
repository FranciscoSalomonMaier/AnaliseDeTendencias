// Disposable PostgreSQL + Nest + local HTTP Google simulator; never contacts Google.
process.env.CONTENT_YOUTUBE_PUBLISHING_TEST = 'true';
require('./publication.integration.cjs');
