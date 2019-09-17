"use strict";

const path     = require('path');
const SContext = require('swift/context');
const Sqlfs    = require('sqlitefs');
const Cloudfs  = require('../');

class cloudfs {

  async simple_ro(config_path) {
    let config = require(path.resolve(config_path));

    let storage_ctx = await SContext.build(config.storage_creds);
    let storage_container = config.storage_container;

    let inode_conf = {
      backend  : {
        type     : 'swift',
        ctx      : await SContext.build(config.inodes_creds),
      },
      container : config.inodes_container,
      filename  : config.inodes_name || 'index.sqlite',
    };

    let inodes = new Sqlfs(inode_conf);
    await inodes.warmup();

    let cloudfs = new Cloudfs(inodes, storage_ctx, storage_container, config.casfs);

    await cloudfs.mount(config.mountpoint);

    process.on('SIGINT', () => {
      console.log('Received SIGINT. Press Control-D to exit.');
    });
  }
}

module.exports = cloudfs;
