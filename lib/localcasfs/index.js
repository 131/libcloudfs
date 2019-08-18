"use strict";

const fs     = require('fs');
const path   = require('path');

const sprintf = require('util').format;
const glob    = require('glob').sync;
const guid    = require('mout/random/guid');
//const sleep  = require('nyks/async/sleep');
const mkdirpSync = require('nyks/fs/mkdirpSync');


const casfs          = require('./casfs');

const RandomReadFile = require('./randomreadfile');
const SeqWriteFile   = require('./seqwritefile');
const {logger} = require('../utils');


class localcasfs extends casfs {

  constructor(inodes, {root_dir, block_size_limit}) {
    super(inodes);

    this.root_dir         = root_dir;
    this.block_size_limit = block_size_limit;

    this.root_incoming = path.join(this.root_dir, '.tmp');
    mkdirpSync(this.root_incoming);
    let tmp = glob(path.join(this.root_incoming, '**'), {nodir : true});

    logger.info("Got %d file(s) to cleanup", tmp);
    for(let file_path of tmp)
      fs.unlinkSync(file_path);

    this.block_path = this.block_path.bind(this);
    this.block_tmp  = this.block_tmp.bind(this);
  }

  block_path(hash) {
    let block_path = sprintf("%s/%s/%s", hash.substr(0, 2), hash.substr(2, 1), hash);
    return path.join(this.root_dir, block_path);
  }

  _cas_open(block_hash) {
    return new RandomReadFile(block_hash);
  }

  block_tmp() {
    return path.join(this.root_incoming, guid());
  }

  _cas_write(inode) {

    let block_end = async (block_hash, block_size) => {
      //now update inodes metadata
      await this.inodes.update(inode, {
        block_hash,
        file_size : block_size,
        file_mtime : Date.now() / 1000
      });
    };

    return new SeqWriteFile({
      block_size_limit : this.block_size_limit,
      block_end,
      block_path : this.block_path
    });
  }
}




module.exports = localcasfs;
