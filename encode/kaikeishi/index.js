const fs = require('fs').promises;
const util = require('util');
const { Dropbox } = require('dropbox');
const fetch = require('isomorphic-fetch');

const amqplib = require('amqplib');

const setTimeoutPromise = util.promisify(setTimeout);

const ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

const batchUploadThreshold = 150 * (1024 * 1024); // 150MiB
const maxChunkSize = 8 * (1024 * 1024); // Dropbox recommended chunk size, 8MiB

let open;
const dbx = new Dropbox({ fetch: fetch, accessToken: ACCESS_TOKEN });

async function connectRabbit() {
  let connection;
  while (!connection) {
    try {
      connection = await amqplib.connect('amqp://guest:guest@rabbitmq');
    } catch(e) {
      console.warn('Couldn\'t connect.');
      await setTimeoutPromise(5000);
      console.log('Trying again.');
    }
  }
  return connection;
}

// As a microservice:
if (require.main === module) {
  open = connectRabbit().catch((e) => {
    console.warn(e, '\nNot connected to Rabbit.');
  });

  // Idle and wait for message.
  // msg: {filepath}
  open.then((conn) => {
    console.log('Waiting to upload files.');
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = 'media_converted';
    ch.prefetch(1);
    return ch.assertQueue(queue).then((ok) => {
      return ch.consume(queue, (msg) => {
        if (!msg) return;
        
        const {
          path: filepath,
          totalParts: totalParts,
          part: part,
        } = JSON.parse(msg.content.toString());

        upload(filepath).then(() => {
          ch.ack(msg);
          sendMetadata(filepath);
          console.log('Uploaded file.');
        }).catch((e) => {
          console.warn(e, 'Cannot upload file.');
        });
      });
    });
  }).catch(console.warn);
}

async function upload(filepath) {
  const uploadPath = filepath.split('/').slice(2).join('/');
  const file = await fs.readFile(filepath, 'utf8');
  if (file.length < batchUploadThreshold) {
    await uploadFile(uploadPath, file);
  } else {
    await uploadChunks(uploadPath, chunkFile(file));
  }
}

async function uploadFile(uploadPath, file) {
  await dbx.filesUpload({ path: `/${uploadPath}`, contents: file });
}

async function uploadChunks(uploadPath, chunks) {
  await chunks.reduce((acc, blob, idx, items) => uploadReducer(uploadPath, acc, blob, idx, items), Promise.resolve());
}

function uploadReducer(uploadPath, acc, blob, idx, items) {
  if (idx === 0) {
    return acc.then(() => {
      return dbx.filesUploadSessionStart({ contents: blob }).then(res => res.session_id);
    });
  } else if (idx === items.length - 1) {
    return acc.then((sessionID) => {
      const cursor = { session_id: sessionID, offset: idx * maxChunkSize };
      const commit = { path: `/${uploadPath}`, mode: 'add', autorename: true, mute: false };
      return dbx.filesUploadSessionFinish({ cursor: cursor, commit: commit, contents: blob });
    })
  } else {
    return acc.then((sessionID) => {
      const cursor = { session_id: sessionID, offset: idx * maxChunkSize };
      return dbx.filesUploadSessionAppendV2({ cursor: cursor, contents: blob }).then(() => sessionID);
    });
  }
}

function chunkFile(file) {
  const chunks = [];

  // Split the given file into uploadable chunks.
  for (let offset = 0, chunkSize = Math.min(maxChunkSize, file.length - offset); offset < file.length; offset += chunkSize) {
    chunks.push(file.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function chunkFiles(files) {
  const chunkedFiles = [];
  for (const f of files) {
    chunkedFiles.push(chunkFile(f));
  }
  return chunkedFiles;
}

function sendMetadata(filepath) {
  const dataJSON = {
    path: filepath,
  };

  open.then((conn) => {
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = '';
    return ch.assertQueue(queue).then((ok) => {
      ch.sendToQueue(queue, Buffer.from(JSON.stringify(dataJSON)));
    });
  }).catch(console.warn);
}