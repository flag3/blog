const fs = require('fs');
const { setTimeout } = require('timers/promises');
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_API_SECRET,
  notionVersion: '2026-03-11',
});

const requestDuration = 300;
const BLOCK_ID = /^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

const pageId = process.argv
  .find((arg) => arg.startsWith('--pageId='))
  .replace('--pageId=', '');
const lastEditedTime = process.argv
  .find((arg) => arg.startsWith('--lastEditedTime='))
  ?.replace('--lastEditedTime=', '');

if (!BLOCK_ID.test(pageId)) {
  throw new Error(`Invalid page ID: ${pageId}`);
}
if (lastEditedTime && !Number.isFinite(Date.parse(lastEditedTime))) {
  throw new Error(`Invalid last edited time: ${lastEditedTime}`);
}

const outputDir = `tmp/${pageId}`;
const blockIds = [];

const retry = (maxRetries, fn) => {
  return fn().catch(function (err) {
    if (maxRetries <= 0) {
      throw err;
    }
    return retry(maxRetries - 1, fn);
  });
};

const retrieveAndWriteBlockChildren = async (blockId) => {
  if (!BLOCK_ID.test(blockId)) {
    throw new Error(`Invalid block ID: ${blockId}`);
  }
  const params = { block_id: blockId };

  let results = [];

  while (true) {
    // For Notion API Requests limits
    // See https://developers.notion.com/reference/request-limits
    await setTimeout(requestDuration);

    const res = await retry(3, () => notion.blocks.children.list(params));

    results = results.concat(res.results);

    if (!res.has_more) {
      break;
    }

    params['start_cursor'] = res.next_cursor;
  }

  fs.writeFileSync(`${outputDir}/${blockId}.json`, JSON.stringify(results));
  blockIds.push(blockId);

  await Promise.all(
    results.map(async (block) => {
      // Synced content can change on another page; the renderer fetches it live.
      if (block.type !== 'synced_block' && block.has_children) {
        await retrieveAndWriteBlockChildren(block.id);
      }
    })
  );
};

const hasExpiringFile = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (value.type === 'file' && value.file) {
    // Leave time for the subsequent Astro build to download the file.
    return !(Date.parse(value.file.expiry_time) > Date.now() + 10 * 60 * 1000);
  }
  return Object.values(value).some(hasExpiringFile);
};

(async () => {
  let files;
  try {
    const metadata = JSON.parse(
      fs.readFileSync(`${outputDir}/.metadata`, 'utf8')
    );
    if (
      lastEditedTime &&
      metadata &&
      metadata.databaseId === process.env.DATABASE_ID &&
      metadata.lastEditedTime === lastEditedTime &&
      Array.isArray(metadata.blockIds) &&
      metadata.blockIds.includes(pageId) &&
      metadata.blockIds.every((id) => BLOCK_ID.test(id))
    ) {
      files = metadata.blockIds.map((id) => {
        const path = `${outputDir}/${id}.json`;
        return { path, blocks: JSON.parse(fs.readFileSync(path, 'utf8')) };
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (
    files?.every(
      ({ blocks }) =>
        Array.isArray(blocks) &&
        blocks.every(
          (block) =>
            block && BLOCK_ID.test(block.id) && typeof block.type === 'string'
        )
    )
  ) {
    for (const { path, blocks } of files) {
      let refreshed = false;
      for (let i = 0; i < blocks.length; i++) {
        if (hasExpiringFile(blocks[i])) {
          await setTimeout(requestDuration);
          blocks[i] = await retry(3, () =>
            notion.blocks.retrieve({ block_id: blocks[i].id })
          );
          refreshed = true;
        }
      }
      if (refreshed) fs.writeFileSync(path, JSON.stringify(blocks));
    }
    return;
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  await retrieveAndWriteBlockChildren(pageId);
  if (lastEditedTime) {
    fs.writeFileSync(
      `${outputDir}/.metadata`,
      JSON.stringify({
        databaseId: process.env.DATABASE_ID,
        lastEditedTime,
        blockIds,
      })
    );
  }
})();
