"use strict";

const fs = require('fs');
const path    = require('path');
const glob = require('glob').sync;
const sprintf = require('util').format;

const crypto = require('crypto');
const guid   = require('mout/random/guid');
const sleep  = require('nyks/async/sleep');
const casfs = require('./casfs');
const mkdirpSync = require('nyks/fs/mkdirpSync');


const {fuse} = require('./utils');

class localcasfs extends casfs {

  constructor(inodes, root_dir) {
    super(inodes);

    this.root_dir      = root_dir;
    this.root_incoming = path.join(root_dir, '.tmp');
    mkdirpSync(this.root_incoming);
    let tmp = glob(path.join(this.root_incoming, '**'), {nodir : true});

    console.log("Got %d file(s) to cleanup", tmp);
    for(let file_path of tmp)
      fs.unlinkSync(file_path);
  }

  block_path(hash) {
    let block_path = sprintf("%s/%s/%s", hash.substr(0, 2), hash.substr(2, 1), hash);
    return path.join(this.root_dir, block_path);
  }

  _cas_open(block_hash) {
    var file_path = this.block_path(block_hash);
    return new RandomReadFile(file_path);
  }


  _cas_write(inode) {

    return new SeqWriteFile(this, inode);
  }
}


class SeqWriteFile {
  constructor(ctl, entry) {
    this.ctl = ctl;
    this.inode = entry;
    this.fd        = null;

    this.target = path.join(ctl.root_incoming, guid());
    this.offset = 0;
  }

  async close() {
    if(!this.fd)
      return;

    fs.closeSync(this.fd);
    this.fd = null;
    let block_hash = this.content_hash.digest("hex");
    let block_path = this.ctl.block_path(block_hash);
    console.log("Got content hash", block_hash, block_path);
    mkdirpSync(path.dirname(block_path));
    fs.renameSync(this.target, block_path);
    //now update inodes metadata
    await this.ctl.inodes.update(this.inode, {
      block_hash,
      file_size : this.offset,
      file_mtime : Date.now() / 1000
    });
    console.log("WAITING 2s");
    await sleep(2000);
  }

  async _open() {
    this.fd = fs.openSync(this.target, "w");
    this.offset = 0;
    this.content_hash = crypto.createHash('md5');
  }

  write(buf, len, pos, cb) {
    if(this.offset != pos)
      return cb(fuse.ESPIPE); //invalid offset

    if(!this.fd) {
      this._open().then(() => {
        this.write(buf, len, pos, cb);
      });
      return;
    }

    this.content_hash.update(buf.slice(0, len));

    fs.write(this.fd, buf, 0, len, pos, (err, size) => {
      this.offset += size;
      cb(size);
    });
  }

}

class RandomReadFile {
  constructor(file_path) {
    this.fd = null;
    this.file_path = file_path;
  }

  close() {
    if(this.fd)
      this.fd = (fs.closeSync(this.fd), null);
  }

  _open() {
    console.log("Opening", this.file_path);
    this.fd = fs.openSync(this.file_path, 'r');
  }

  read(buf, len, offset, cb) {
    if(!this.fd)
      this._open();

    fs.read(this.fd, buf, 0, len, offset, function(err, size) {
      cb(size);
    });
  }

}


module.exports = localcasfs;
