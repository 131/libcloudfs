"use strict";

const http  = require('http');
const Sqlfs   = require('sqlitefs');
const Cloudfs = require('libcloudfs');

const SContext = require('swift/context');
const Storage  = require('swift/storage');
const sprintf = require('util').format;
const CCD     = require('libcloudfs/lib/ccd');
const eachLimit = require('nyks/async/eachLimit');

const storage_container = "trashme_tests_ci";
const creds  = require('./test/credentials.json');

const block_path = function(hash) {
  return sprintf("%s/%s/%s", hash.substr(0, 2), hash.substr(2, 1), hash);
};

class thecube {

  constructor() {
    this.server = http.createServer(this._rest.bind(this));
  }
  async start() {
    //this.server.listen(5600);
    this.storage_ctx  = await SContext.build(creds);
    this.ccd = new CCD({storage_ctx : this.storage_ctx, storage_container, block_path});
    process.on('cnyksEnd', function() {
      console.log("should quit");
    });
  }

  async _rest(req, res) {
    if(req.url == "/quit") {
      await this.inodes.close();
      process.exit();
    }

    if(req.url == "/tick")
      await this.tick();
    res.end("OKAY " + req.url);
  }

  async list() {
    let res = await Storage.getFileList(this.storage_ctx, storage_container);
    return res;
  }

  async tick() {
    await this.ccd.tick(true);
  }

  async purge() {
    var res = await Storage.getFileList(this.storage_ctx, storage_container);
    console.log("Should purge %d files", res.length);
    await eachLimit(res, 5, async (file) => {
      await Storage.deleteFile(this.storage_ctx, storage_container, file.name);
    });
  }

  async mount() {

    let data = {
      backend  : {type : 'local'},
      filename : "./data/index.sqlite",
    };

    data = {
      backend  : {
        type     : 'swift',
        ctx      : this.storage_ctx,
      },
      container : storage_container,
      filename  : 'index.sqlite',
    };

    this.inodes = new Sqlfs(data);
    await this.inodes.warmup();


    this.cloudfs = new Cloudfs(this.inodes, this.storage_ctx, storage_container);

    let mountPath = process.platform !== 'win32' ? '/mnt/thecube' : 'M:';
    console.log("All good, mounting file system");
    await this.cloudfs.mount(mountPath);

    process.on('SIGINT', () => {
      console.log('Received SIGINT. Press Control-D to exit.');
    });
  }

}

module.exports = thecube;
