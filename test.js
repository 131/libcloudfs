"use strict";

const path  = require('path');
const tmppath = require('nyks/fs/tmppath');

const Sqlfs = require('sqlitefs');
const Localcasfs = require('./lib/localcasfs');

class tester {

  async run() {

    let mountPath = path.join(__dirname, 'nowhere');
    let fixture_paths = path.join(__dirname, 'test', 'localcas');
    let mock = require(path.join(fixture_paths, 'index.json'));

    let inodes_path = tmppath("sqlite");
    let inodes = new Sqlfs(inodes_path);

    await inodes.warmup();
    await inodes.load(mock);

    let server = new Localcasfs(inodes, fixture_paths);
    console.log("All good, mounting file system");
    await server.mount(mountPath);
  }

}

module.exports = tester;
