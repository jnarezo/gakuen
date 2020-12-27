const path = require('path');
const util = require('util');
const chokidar = require('chokidar');

const amqplib = require('amqplib');

const setTimeoutPromise = util.promisify(setTimeout);

const WATCH_DIRECTORY = 'media/raw';
const OUTPUT_RESOLUTIONS = [
  // '320x180',
  '640x360',
  // '1280x720',
  // '1920x1080',
];

let open;
const watchlist = {};

// Watch for a source ->
// Inspect the source:
// 1. Check quality.
// 2. Generate metadata for the encoders.
// (3). Upload chunks to object storage / stream.

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

if (require.main === module) {
  open = connectRabbit().then((conn) => {
    console.log(`Watching '${WATCH_DIRECTORY}'.`);
    startWatch(WATCH_DIRECTORY);
    return conn;
  }).catch((e) => {
    console.warn(e, '\nNot connected to Rabbit.');
  });
}

function hasDockerEnv() {
	try {
		fs.statSync('/.dockerenv');
		return true;
	} catch (_) {
		return false;
	}
}

function startWatch(directory) {
  watchlist[directory] = chokidar.watch(directory, {
    persistent: true,
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    ignoreInitial: true,
    depth: 5,
    awaitWriteFinish: true,
  }).on('add', (filename) => {
    const extension = path.extname(filename);
    switch (extension) {
      case '.webm':
      case '.mkv':
      case '.mp4':
      case '.m2ts':
        console.log(`File found: ${filename}`);
        queueEncode(filename);  // Replace with an S3 link? (not necessary if we use `goofys`)
        break;
      default:
        console.log(`Unrecognized file: ${filename}`);
        break;
    }
  });
}

function endWatch(directory) {
  if (watchlist[directory]) {
    watchlist[directory].close().then(() => {
      delete watchlist[directory];
    }).catch((e) => {
      console.log('Error closing video directory watch:', e);
    });
  }
}

function queueEncode(filepath) {
  if (!open) return;

  const tasks = [];

  for (const res of OUTPUT_RESOLUTIONS) {
    tasks.push({
      type: 'video',
      path: filepath,
      resolution: res,
    });
  }
  tasks.push({
    type: 'audio',
    path: filepath,
  });

  open.then((conn) => {
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = 'media_raw';
    return ch.assertQueue(queue).then((ok) => {
      for (const t of tasks) {
        ch.sendToQueue(queue, Buffer.from(JSON.stringify(t)));
      }
    });
  }).catch(console.warn);
}