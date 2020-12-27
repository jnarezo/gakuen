const path = require('path');
const util = require('util');
const amqplib = require('amqplib');
const shell = require('shelljs');

const setTimeoutPromise = util.promisify(setTimeout);

shell.config.silent = true;

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
  const Koa = require('koa');
  const app = new Koa();
  
  app.use(async (ctx, next) => {
    const data = {
      link: 'https://livesim.dashif.org/livesim/testpic_2s/Manifest.mpd',
      languages: ['en', 'ja'],
    };
    ctx.body = JSON.stringify(data);
    await next();
  }).on('error', (e) => {
    console.log(e);
  });
  app.listen(5014);

  open = connectRabbit().catch((e) => {
    console.warn(e, '\nNot connected to Rabbit.');
  });

  // Idle and wait for message.
  // msg: {videoID}|{streamNum}|{totalStreams}|{link/path}
  open.then((conn) => {
    console.log('Waiting to create a manifest.');
    process.once('SIGINT', conn.close.bind(conn));
    return conn.createChannel();
  }).then((ch) => {
    const queue = 'metadata';
    ch.prefetch(1);
    return ch.assertQueue(queue).then((ok) => {
      return ch.consume(queue, (msg) => {
        if (!msg) return;

        const {
          path: dir,
          upload_path: uploadPath,
        } = JSON.parse(msg.content.toString());
        createManifestShaka(dir);
        // TODO: Upload manifest to Dropbox/storage/Redis.
        ch.ack(msg);
      });
    });
  }).catch(console.warn);
}

function createManifestShaka(inputPath) {
  // const foldername = path.basename(inputPath);
  shell.cd(inputPath);
  const files = shell.ls('*.webm');
  const inputArgs = files.map(f => (`in=${f},stream=${f.split('_')[0]},out=${f.split('_')[1]}`));

  shell.exec(`packager \
      ${inputArgs.join(' ')} \
      --mpd_output ${output}.mpd`
  );
  shell.cd('..');
}

function createManifestFFMPEG(inputPath) {
  const mapOptions = [];
  
  shell.cd(inputPath);
  const files = shell.ls('*.webm');
  const inputArgs = files.map(f => (`-f webm_dash_manifest -i ${files[i]}`));
  const streams = [];
  for (let i = 0; i < files.length; i++) {
    mapOptions.push(`-map ${i}`);
    streams.push(i);
  }

  shell.exec(`ffmpeg -y \
      ${inputArgs.reverse().join(' ')} \
      -c copy ${mapOptions.join(' ')} \
      -f webm_dash_manifest \
      -adaptation_sets "id=0,streams=${streams.slice(0, streams.length-1).join(',')} id=1,streams=${streams[streams.length-1]} \
      manifest.mpd`
  );
  shell.cd('..');
}

function setupOutput(outpath) {
  if (shell.ls().length !== 1) {
    shell.mkdir('media/converted');
    shell.mkdir(outpath);
    // if (shell.error()) return;
    // if (shell.ls(`${filename}/${inputPath}`).length === 0) {
    //   fs.symlink(inputPath, `${filename}/${inputPath}`, 'file', (e) => {
    //     if (e) console.log(e); // error
    //   });
    // }
  }
}

function isVideo(filename) {
  const words = filename.split('_');
  return (words[0] === 'video');
}