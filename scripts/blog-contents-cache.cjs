const { exec } = require('child_process');
const fs = require('fs');
const { Client } = require('@notionhq/client');
const cliProgress = require('cli-progress');
const { PromisePool } = require('@supercharge/promise-pool');

const notion = new Client({
  auth: process.env.NOTION_API_SECRET,
  notionVersion: '2026-03-11',
});

const getAllPages = async () => {
  const dbResponse = await notion.databases.retrieve({
    database_id: process.env.DATABASE_ID,
  });
  if (!dbResponse) {
    throw new Error('Failed to retrieve database information');
  }

  const dataSourceId =
    dbResponse.data_sources && dbResponse.data_sources.length > 0
      ? dbResponse.data_sources[0].id
      : null;
  if (!dataSourceId) {
    throw new Error('Database does not have a data source ID');
  }

  const params = {
    data_source_id: dataSourceId,
    filter: {
      and: [
        {
          property: 'Published',
          checkbox: {
            equals: true,
          },
        },
        {
          property: 'Date',
          date: {
            on_or_before: new Date().toISOString(),
          },
        },
      ],
    },
  };

  let results = [];
  while (true) {
    const res = await notion.dataSources.query(params);

    results = results.concat(res.results);

    if (!res.has_more) {
      break;
    }

    params['start_cursor'] = res.next_cursor;
  }

  const pages = results.map((result) => {
    return {
      id: result.id,
      last_edited_time: result.last_edited_time,
      slug: result.properties.Slug.rich_text
        ? result.properties.Slug.rich_text[0].plain_text
        : '',
    };
  });

  return pages;
};

(async () => {
  const pages = await getAllPages();

  const concurrency = parseInt(process.env.CACHE_CONCURRENCY || '1', 10);

  const BLOCK_ID =
    /^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;
  for (const page of pages) {
    if (
      !BLOCK_ID.test(page.id) ||
      !Number.isFinite(Date.parse(page.last_edited_time))
    ) {
      throw new Error('Notion returned an invalid page ID or last edited time');
    }
  }

  fs.mkdirSync('tmp', { recursive: true });
  const pageIds = new Set(pages.map((page) => page.id));
  for (const entry of fs.readdirSync('tmp', { withFileTypes: true })) {
    if (
      (entry.isDirectory() &&
        BLOCK_ID.test(entry.name) &&
        !pageIds.has(entry.name)) ||
      (entry.isFile() &&
        entry.name.endsWith('.json') &&
        BLOCK_ID.test(entry.name.slice(0, -5)))
    ) {
      fs.rmSync(`tmp/${entry.name}`, { recursive: true, force: true });
    }
  }

  const progressBar = new cliProgress.SingleBar(
    { stopOnComplete: true },
    cliProgress.Presets.shades_classic
  );
  progressBar.start(pages.length, 0);

  await PromisePool.withConcurrency(concurrency)
    .for(pages)
    .handleError((error) => {
      throw error;
    })
    .process(async (page) => {
      return new Promise((resolve) => {
        const command = `node scripts/retrieve-block-children.cjs --pageId=${page.id} --lastEditedTime='${page.last_edited_time.replace(/'/g, "'\\''")}'`;
        const options = { timeout: 60000 };

        exec(command, options, (err, stdout, stderr) => {
          if (err) {
            console.error(`exec error: ${err}`);
            process.exitCode = 1;
          }
          progressBar.increment();
          return resolve();
        });
      });
    });
})();
