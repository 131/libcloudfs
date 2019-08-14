"use strict";

const net = require('net'); //simple ipc
const fs = require('fs');
const path  = require('path');
const cp   = require('child_process');

const Sqlfs = require('sqlitefs');

const guid   = require('mout/random/guid');
const expect = require('expect.js');
const tmppath = require('nyks/fs/tmppath');
const drain = require('nyks/stream/drain');
const promisify = require('nyks/function/promisify');
const passthru = promisify(require('nyks/child_process/passthru'));
const glob  = promisify(require('glob'));
//const sleep  = require('nyks/async/sleep');

const Localcasfs = require('../lib/localcasfs');

const {filesize, fileExists, touch} = require('../lib/utils');//, filemtime

let child;

const mountPath = path.join(__dirname, 'nowhere');
var fixture_paths = path.join(__dirname, 'localcas');
var  mock = require(path.join(fixture_paths, 'index.json'));


/**
* Under linux, when fuse and the test suite are running in the same process/thread
* file close-to-open schematic seems broken
*   e.g. openW => write => openR => closeW(!) => bad contents
* When running in a separate process
*  openW => write => closeW => openR => proper contents
*/
let moutServer = async () => {
  let inodes_path = tmppath("sqlite");
  let inodes = new Sqlfs(inodes_path);

  await inodes.warmup();
  await inodes.load(mock);
  let server = new Localcasfs(inodes, fixture_paths);

  await server.mount(mountPath);
};

if(process.argv[2] == "child") {
  return moutServer().then(() => {
    let lnk = net.connect(process.argv[3]);//trigger back
    lnk.on('error', () => {});
  });
}

describe("Initial localfs setup", function() {
  this.timeout(10 * 1000);

  it("should create a proper mountpoint", async () => {
    if(process.platform != "win32") {
      try {
        await passthru("fusermount", ['-u', mountPath]);
      } catch(err) {}
    }

    var args = ["node_modules/nyc/bin/nyc.js", "--temp-directory", "coverage/.nyc_output", "--preserve-comments", "--reporter", "none", "--silent"];

    let server = net.createServer();
    server.on('error', () => {});
    let port = await new Promise((resolve) => {
      server.listen(() => {
        resolve(server.address().port);
      });
    });

    args.push("node", __filename, "child", port);
    child = cp.spawn('node', args, {'stdio' : 'inherit'});
    console.log("Spawning", process.execPath, args.join(' '));
    console.log("Awaiting for subprocess (mount) to be ready");
    let lnk = await new Promise(resolve => server.on('connection', resolve));
    lnk.on('error', () => {});
    console.log("Child is ready, lets proceed");
  });
});


//note that we CANNOT use ANY sync methods (since we ARE in the very same thread)

describe("testing localcasfs read", function() {


  it("should match references files", async () => {

    for(let entry of mock) {
      let file_path = path.join(mountPath, entry.file_path);
      let file_name = path.basename(file_path);
      let body = fs.createReadStream(file_path);
      body = String(await drain(body));
      let challenge = file_name == 'empty' ? '' : file_name;

      expect(body).to.be(challenge);
      expect(await filesize(file_path)).to.eql(entry.file_size);
    }
  });

  it("should support fs.existsSync", async () => {
    let nope_path = path.join(mountPath, '/this/is/not/a/file');
    expect(await fileExists(nope_path)).to.be(false);
  });

  it("should support file search", async () => {
    let files = await glob('**', {cwd : mountPath, nodir : true});
    let challenge = mock.map(entry => entry.file_path.substr(1)); //drop /
    files.sort(), challenge.sort();
    expect(challenge).to.eql(files);
  });

});



describe("testing localcasfs inode update", function() {
  //testing mkdir, touch, unlink & ... through fuse


  it("should touch a dummy file", async () => {
    let somepath = path.join(mountPath, "/this/is/a/file");

    expect(await fileExists(somepath)).to.be(false);
    await touch(somepath);
    expect(await fileExists(somepath)).to.be.ok();
  });

  /*
  it("should touch a file at a specific date", async () => {
    let somepath = path.join(mountPath, "/this/is/a/file");
    let when = new Date('1986-02-15T10:14:52.000Z'); //ms are not supported (yet)
    await touch(somepath, when);
    expect(Number(await filemtime(somepath))).to.eql(Number(when));
  });
  */

});


describe("testing localcasfs data write", function() {
  this.timeout(60 * 1000);


  it("should write a simple file", async () => {
    let random = guid(), payload = "this is contents";
    let subpath = "/this/is/a/newfile";
    let somepath = path.join(mountPath, subpath);
    let dst = fs.createWriteStream(somepath);
    dst.write(random), dst.end(payload);

    await new Promise(resolve => dst.on('finish', resolve));

    console.log("Done writing, now checking");
    let body = fs.createReadStream(somepath, {flags : 'rs'});
    body = String(await drain(body));
    expect(body).to.eql(random + payload);
  });

  it("should stress file write abit", async () => {
    for(let i = 0; i < 1000; i++) {
      let random = guid();
      let subpath = "/somewhere";
      let somepath = path.join(mountPath, subpath);
      fs.writeFileSync(somepath, random);
      let challenge = fs.readFileSync(somepath, 'utf8');
      expect(challenge).to.eql(random);
    }
  });
});


describe("Shutting down", function() {

  it("Should shutdown child and write coverage", async () => {

    child.kill('SIGINT');
    let exit = await new Promise(resolve => child.on('exit', resolve));
    console.log("Got exit code", exit);

    if(process.platform == "win32")
      return;
    try {
      await passthru("fusermount", ['-u', mountPath]);
    } catch(err) {}
  });
});




