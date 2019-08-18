"use strict";

const Storage = require('swift/storage');
const RandomReadHTTP = require('random-read-http');
const sprintf = require('util').format;

const casfs = require('casfs');

// this is dummy openstack swift adapter to casfs

class cloudfs extends casfs {
  constructor(inodes, dst_ctx, dst_container) {
    super(inodes);
    this.dst_ctx       = dst_ctx;
    this.dst_container = dst_container;
  }

  block_path(hash) {
    return sprintf("%s/%s/%s", hash.substr(0, 2), hash.substr(2, 1), hash);
  }

  _cas_open(block_hash) {
    let block_path = this.block_path(block_hash);
    var remoteUrl  = Storage.tempURL(this.dst_ctx, this.dst_container, block_path);
    return new RandomReadHTTP(remoteUrl, {
      MAX_BL_SIZE : 100 * 1024 * 1024,
      MIN_BL_SIZE : 20 * 1024 * 1024,
    });
  }
}


module.exports = cloudfs;
