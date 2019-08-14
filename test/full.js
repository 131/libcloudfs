"use strict";

const fs = require('fs');
const path  = require('path');
const Sqlfs = require('sqlitefs');

const guid   = require('mout/random/guid');
const expect = require('expect.js');
const tmppath = require('nyks/fs/tmppath');
const drain = require('nyks/stream/drain');
const promisify = require('nyks/function/promisify');
const glob  = promisify(require('glob'));
//const sleep  = require('nyks/async/sleep');

const Localcasfs = require('../lib/localcasfs');

const {filesize, fileExists, touch} = require('../lib/utils');//, filemtime


/*
* I'd want to warmup/unmount properly per test suite
* Yet on windows, unmount is not handled
* Waiting for https://github.com/fuse-friends/fuse-shared-library/issues/1
* so i can handle that properly
*/

var server, inodes; //ULTRA SCOPE (therefore...)
const mountPath = path.join(__dirname, 'nowhere');
var fixture_paths = path.join(__dirname, 'localcas');
var  mock = require(path.join(fixture_paths, 'index.json'));

describe("Initial localfs setup", function() {


  let inodes_path = tmppath("sqlite");
  inodes = new Sqlfs(inodes_path);

  it("should create a proper mountpoint", async () => {
    await inodes.warmup();
    await inodes.load(mock);
    server = new Localcasfs(inodes, fixture_paths);
    await server.mount(mountPath);
  });

  /* //nope
  after("should shutdown mountpoing", async () => {
    await inodes.close();
    await server.close();
  });
  */

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

    console.log("Done writing, now checking", await inodes._get_entry(subpath));
    let body = fs.createReadStream(somepath);
    body = String(await drain(body));
    expect(body).to.eql(random + payload);
  });




});





