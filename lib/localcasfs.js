"use strict";

const fs = require('fs');
const path    = require('path');


const casfs = require('./casfs');


class localcasfs extends casfs {

  constructor(inodes, root_dir) {
    super(inodes);
    this.root_dir = root_dir;
  }

  _cas_open(block_path) {
    var file_path = path.join(this.root_dir, block_path);
    return new RandomReadFile(file_path);
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
