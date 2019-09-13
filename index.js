"use strict";

const Storage = require('swift/storage');

const RandomReadHTTP = require('random-read-http');
const SeqWriteHTTP   = require('./lib/seqwritehttp');
const CCD            = require('./lib/ccd');


const casfs   = require('casfs');

// this is dummy openstack swift adapter to casfs

class cloudfs extends casfs {

  constructor(inodes, storage_ctx, storage_container) {
    super(inodes);

    this.storage_ctx       = storage_ctx;
    this.storage_container = storage_container;

    this.ccd = new CCD({
      storage_ctx       : this.storage_ctx,
      storage_container : this.storage_container,
      block_path        : this.block_path,
    });
  }

  _cas_read(inode) {
    let block_path = this.block_path(inode.block_hash);
    var remoteUrl  = Storage.tempURL(this.storage_ctx, this.storage_container, block_path);
    return new RandomReadHTTP(remoteUrl, {
      MAX_BL_SIZE : 100 * 1024 * 1024,
      MIN_BL_SIZE : 20 * 1024 * 1024,
    });
  }

  _cas_write(/*inode*/) {
    return new SeqWriteHTTP({
      storage_ctx       : this.storage_ctx,
      storage_container : this.storage_container,
      block_path        : this.block_path,
    });
  }
}


module.exports = cloudfs;
