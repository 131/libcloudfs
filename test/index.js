"use strict";

const fs = require('fs');
const path  = require('path');
const Sqlfs = require('sqlitefs');

const expect = require('expect.js');
const tmppath = require('nyks/fs/tmppath');
const drain = require('nyks/stream/drain');
const promisify = require('nyks/function/promisify');
const glob  = promisify(require('glob'));

const Localcasfs = require('../lib/localcasfs');

const {filesize, fileExists} = require('../lib/utils');


//note that we CANNOT use ANY sync methods (since we ARE in the very same thread)

describe("testing localcasfs", function() {

  this.timeout(60 * 1000);

  let mountPath = path.join(__dirname, 'nowhere');
  let fixture_paths = path.join(__dirname, 'localcas');
  let mock = require(path.join(fixture_paths, 'index.json'));

  let inodes_path = tmppath("sqlite");
  let inodes = new Sqlfs(inodes_path);

  before("should create a proper mountpoint", async () => {
    await inodes.warmup();
    await inodes.load(mock);
    let server = new Localcasfs(inodes, fixture_paths);
    await server.mount(mountPath);
  });

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
