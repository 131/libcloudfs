"use strict";

const Storage = require('swift/storage');
const RandomReadHTTP = require('random-read-http');

const casfs = require('./lib/casfs');

// this is dummy openstack swift adapter to casfs

class cloudfs extends casfs {
  constructor(inodes, dst_ctx, dst_container) {
    super(inodes);
    this.dst_ctx       = dst_ctx;
    this.dst_container = dst_container;

  }

  _cas_open(block_path) {
    var remoteUrl  = Storage.tempURL(this.dst_ctx, this.dst_container, block_path);
    return new RandomReadHTTP(remoteUrl, {
      MAX_BL_SIZE : 100 * 1024 * 1024,
      MIN_BL_SIZE : 20 * 1024 * 1024,
    });
  }
}


module.exports = cloudfs;
