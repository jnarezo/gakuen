const path = require('path');
const util = require('util');
const shell = require('shelljs');
const ffmpeg = require('fluent-ffmpeg');

const amqplib = require('amqplib');

const setTimeoutPromise = util.promisify(setTimeout);

shell.config.silent = true;

const VP9_DASH_PARAMS = '-tile-columns 4 -frame-parallel 1';
const OUTPUT_DIRECTORY = 'media/converted';
const RESOLUTION_QUALITY = {
  '320x180': '500k',
  '640x360': '750k',
  '1280x720': '1000k',
  '1920x1080': '1500k',
};

let open;

// Idle, wait for message to encode ->
// 1. Grab/clone/download/stream source media.
// 2. Encode source (alone, or in parallel)
// 3. Upload converted to object store / static file server.
// (4). Remove local files.

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
  open.then((conn) => {
    console.log('Listening. Ready to encode.');
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = 'media_raw';
    ch.prefetch(1);
    return ch.assertQueue(queue).then((ok) => {
      return ch.consume(queue, (msg) => {
        if (!msg) {
          console.warn(`Received an empty message?`);
          ch.ack(msg);
        }

        const {
          type: type,
          path: sourcePath,
          resolution: resolution,
        } = JSON.parse(msg.content.toString());

        switch (type) {
          case 'audio':
            encodeAudio(sourcePath, () => ch.ack(msg));
            break;
          case 'video':
            encodeVideo(sourcePath, resolution, () => ch.ack(msg));
            break;
          default:
            console.warn(`Unrecognized file type: ${type}`);
            break;
        }
      });
    });
  }).catch(console.warn);
}

// TODO: split encode based on the message.
function encodeAudio(inputPath, callback) {
  // const filename = inputPath.replace(/ +/g, '_').replace(/\.[^/\\.]+$/, '');

  // Replace spaces with underscores.
  const filename = path.basename(inputPath.replace(/ +/g, '_'));
  // Remove filename extension.
  const outputDir = `${OUTPUT_DIRECTORY}/${filename.replace(/\.[^/\\.]+$/, '')}`;
  const outputPath = `${outputDir}/audio_128k.webm`;

  setupOutput(outputDir);

  console.log(`[Audio] Encoding '${inputPath}'...`);

  // Create audio stream.
  const audioCMD = ffmpeg(`${inputPath}`)
      .audioCodec('libopus')
      .output(outputPath)
      .format('webm')
      .audioBitrate('128k')
      .noVideo()
      .outputOptions('-dash 1')
      .on('end', () => {
        console.log('...and success!');
        callback();
        notifyConversion(outputPath);
      })
      .on('error', (e) => {
        console.warn(e);
      });
  audioCMD.run();
}

// TODO: split encode based on the message.
function encodeVideo(inputPath, size, callback) {
  // const filename = inputPath.replace(/ +/g, '_').replace(/\.[^/\\.]+$/, '');

  // Replace spaces with underscores.
  const filename = path.basename(inputPath.replace(/ +/g, '_'));
  // Remove filename extension.
  const outputDir = `${OUTPUT_DIRECTORY}/${filename.replace(/\.[^/\\.]+$/, '')}`;
  const outputPath = `${outputDir}/video_${size}_${RESOLUTION_QUALITY[size]}.webm`;

  setupOutput(outputDir);

  console.log(`[Video] Encoding '${inputPath}' @ ${size}...`);

  // Create video streams.
  const videoCMD = ffmpeg(`${inputPath}`)
      .videoCodec('libvpx-vp9')
      .output(outputPath)
      .format('webm')
      .size(size)
      .videoBitrate(RESOLUTION_QUALITY[size])
      .noAudio()
      .outputOptions([
        '-keyint_min 150',
        '-g 150',
        '-tile-columns 4',
        '-frame-parallel 1',
        '-dash 1',
      ])
      .on('end', () => {
        console.log('...and success!');
        callback();
        notifyConversion(outputPath);
      })
      .on('error', (e) => {
        console.warn(e);
      });
  videoCMD.run();
}

function notifyConversion(filepath) {
  const dataJSON = {
    path: filepath,
  };

  open.then((conn) => {
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = 'media_converted';
    return ch.assertQueue(queue).then((ok) => {
      ch.sendToQueue(queue, Buffer.from(JSON.stringify(dataJSON)));
    });
  }).catch(console.warn);
}

function setupOutput(outpath) {
  if (shell.ls().length !== 1) {
    shell.mkdir(OUTPUT_DIRECTORY);
    shell.mkdir(outpath);
    // if (shell.error()) return;
    // if (shell.ls(`${filename}/${inputPath}`).length === 0) {
    //   fs.symlink(inputPath, `${filename}/${inputPath}`, 'file', (e) => {
    //     if (e) console.log(e); // error
    //   });
    // }
  }
}